/**
 * taskCleanup（9.22，每日 03:00）
 * ① 24h 前未被引用的 mediaAssets → 删云存储 + 删记录
 * ② 清理 2 天前的 rateLimits
 * ③ 注销冷静期到期用户 → 匿名化，内容转 deleted
 */
const { cloud, coll, _, COL, db, ms, batchUpdate } = require('./lib/db');
const { audit } = require('./lib/auth');
const { isStillReferenced } = require('./lib/mediahelper');

const DAY = 86400000;

async function cleanMedia() {
  let removed = 0;
  let failed = 0;
  let skipped = 0;
  const beforeMs = Date.now() - DAY;
  const before = new Date(beforeMs);
  // 同一条记录的 createdAt 可能是 Date 类型（db.serverDate()），
  // 也可能是 ISO 字符串（脚本/其他端写入）。两种类型互不匹配 →
  // 两种阈值都查一遍，否则字符串类型的数据永远扫不到（永远清不掉）。
  const beforeIso = new Date(beforeMs).toISOString();

  for (let round = 0; round < 3; round += 1) {
    let rows = [];
    const seen = new Set();
    for (const thr of [before, beforeIso]) {
      try {
        const res = await coll(COL.mediaAssets)
          .where({ refCount: _.lte(0), createdAt: _.lt(thr) })
          .orderBy('createdAt', 'asc')
          .limit(50)
          .get();
        for (const r of (res.data || [])) {
          if (r && r._id && !seen.has(r._id)) {
            seen.add(r._id);
            rows.push(r);
          }
        }
      } catch (e) {
        // ⚠️ 不再静默：查询失败时整个清理逻辑会跳过（看起来像"没有垃圾"），
        //    必须留日志，否则误以为清理正常执行
        console.error('[taskCleanup] cleanMedia 查询失败:', e && (e.errMsg || e.message));
      }
    }
    if (!rows.length) break;

    for (const m of rows) {
      // ⚠️ 删除前二次校验：refCount 可能因 incRef 静默失败而恒为 0，
      //    二次确认没被 users.avatar / posts.media 引用再删，
      //    否则头像/帖子图片会被误删（头像变空白、线上裂图）。
      // eslint-disable-next-line no-await-in-loop
      const stillUsed = await isStillReferenced(m.fileId);
      if (stillUsed) {
        skipped += 1;
        // 标记为在用，避免下次又被扫到
        try {
          // eslint-disable-next-line no-await-in-loop
          await coll(COL.mediaAssets).doc(m._id).update({ data: { refCount: 1 } });
        } catch (e) { /* ignore */ }
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await cloud.deleteFile({ fileList: [m.fileId] });
      } catch (e) {
        failed += 1;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await coll(COL.mediaAssets).doc(m._id).remove();
        removed += 1;
      } catch (e) { /* ignore */ }
    }
    if (rows.length < 50) break;
  }
  return { removed, failed, skipped };
}

async function cleanRateLimits() {
  const before = new Date(Date.now() - 2 * DAY);
  let removed = 0;
  for (let round = 0; round < 5; round += 1) {
    try {
      const res = await coll(COL.rateLimits)
        .where({ windowStart: _.lt(before) })
        .field({ _id: true })
        .limit(200)
        .get();
      const rows = res.data || [];
      if (!rows.length) break;
      // eslint-disable-next-line no-await-in-loop
      const up = await coll(COL.rateLimits)
        .where({ _id: _.in(rows.map((r) => r._id)) })
        .remove();
      removed += (up.stats && up.stats.removed) || rows.length;
      if (rows.length < 200) break;
    } catch (e) {
      break;
    }
  }
  return { removed };
}

async function purgeDeactivated() {
  const now = new Date();
  let users = [];
  try {
    const res = await coll(COL.users)
      .where({ status: 'deactivating', deleteAt: _.lt(now) })
      .limit(20)
      .get();
    users = res.data || [];
  } catch (e) {
    return { users: 0, posts: 0, comments: 0 };
  }

  let posts = 0;
  let comments = 0;
  for (const u of users) {
    try {
      // ⚠️ 单次 where().update() 上限约 100 条 → 帖子/评论超过 100 条时
      // 剩下的没被清理（用户注销了但内容还在）。改用分批更新。
      // eslint-disable-next-line no-await-in-loop
      const p = await batchUpdate(COL.posts, { authorUid: u._id, status: _.neq('deleted') }, {
        status: 'deleted', deletedAt: db.serverDate(),
      });
      posts += p;
    } catch (e) { /* ignore */ }
    try {
      // eslint-disable-next-line no-await-in-loop
      const c = await batchUpdate(COL.comments, { authorUid: u._id, status: _.neq('deleted') }, {
        status: 'deleted',
      });
      comments += c;
    } catch (e) { /* ignore */ }
    try {
      // eslint-disable-next-line no-await-in-loop
      await coll(COL.users).doc(u._id).update({
        data: {
          // 置为不可再登录的占位值，同时避免 openid 唯一索引冲突
          openid: `deleted_${u._id}`,
          status: 'deleted',
          nickname: '已注销用户',
          avatar: null,
          purgedAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await audit(u._id, 'delete', 'user', u._id, { status: 'deactivating' }, { status: 'deleted' }, 'cooling_off_expired');
    } catch (e) { /* ignore */ }
  }
  return { users: users.length, posts, comments };
}

exports.main = async () => {
  const media = await cleanMedia();
  const rate = await cleanRateLimits();
  const purge = await purgeDeactivated();
  const result = { ok: true, media, rate, purge, at: ms(new Date()) };
  console.log('[taskCleanup]', JSON.stringify(result));
  return result;
};
