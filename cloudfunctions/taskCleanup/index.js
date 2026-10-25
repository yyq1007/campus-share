/**
 * taskCleanup（9.22，每日 03:00）
 * ① 24h 前未被引用的 mediaAssets → 删云存储 + 删记录
 * ② 清理 2 天前的 rateLimits
 * ③ 注销冷静期到期用户 → 匿名化，内容转 deleted
 */
const { cloud, coll, _, COL, db, ms } = require('./lib/db');
const { audit } = require('./lib/auth');

const DAY = 86400000;

async function cleanMedia() {
  let removed = 0;
  let failed = 0;
  const before = new Date(Date.now() - DAY);

  for (let round = 0; round < 3; round += 1) {
    let rows = [];
    try {
      const res = await coll(COL.mediaAssets)
        .where({ refCount: _.lte(0), createdAt: _.lt(before) })
        .orderBy('createdAt', 'asc')
        .limit(50)
        .get();
      rows = res.data || [];
    } catch (e) {
      break;
    }
    if (!rows.length) break;

    for (const m of rows) {
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
  return { removed, failed };
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
      // eslint-disable-next-line no-await-in-loop
      const p = await coll(COL.posts).where({ authorUid: u._id, status: _.neq('deleted') }).update({
        data: { status: 'deleted', deletedAt: db.serverDate() },
      });
      posts += (p.stats && p.stats.updated) || 0;
    } catch (e) { /* ignore */ }
    try {
      // eslint-disable-next-line no-await-in-loop
      const c = await coll(COL.comments).where({ authorUid: u._id, status: _.neq('deleted') }).update({
        data: { status: 'deleted' },
      });
      comments += (c.stats && c.stats.updated) || 0;
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
