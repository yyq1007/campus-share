/**
 * interactionToggle（9.10）
 * 事务内 upsert interactions（_id 由 uid+目标+类型 决定，天然唯一）→ 同步 stats 计数
 * 计数用「读旧值 + 绝对值写回」并取 max(0)，避免连点导致的负数
 * 副作用：新增 like/fav 时给作者写合并消息（dedupeKey 唯一，自己操作自己不发）
 */
const { coll, COL, db, excerpt } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const msg = require('./lib/msg');

const STAT_KEY = { like: 'likeCount', fav: 'favCount' };
const MAX_RETRY = 2;

function interId(uid, targetType, targetId, type) {
  return `${uid}_${targetType}_${targetId}_${type}`;
}

async function toggleOnce(id, uid, targetType, targetId, type) {
  const t = await db.startTransaction();
  try {
    let existed = false;
    try {
      const hit = await t.collection(COL.interactions).doc(id).get();
      existed = !!(hit && hit.data);
    } catch (e) {
      existed = false;
    }

    let post;
    try {
      const r = await t.collection(COL.posts).doc(targetId).get();
      post = r.data;
    } catch (e) {
      await t.rollback();
      return { error: fail(40401) };
    }
    if (!post || post.status === 'deleted') {
      await t.rollback();
      return { error: fail(40401) };
    }

    // 取号：收藏取消逻辑仍走同一路径
    const delta = existed ? -1 : 1;
    if (existed) {
      await t.collection(COL.interactions).doc(id).remove();
    } else {
      await t.collection(COL.interactions).add({
        data: {
          _id: id,
          uid,
          targetType,
          targetId,
          type,
          createdAt: new Date(),
        },
      });
    }

    const stats = Object.assign(
      { likeCount: 0, favCount: 0, commentCount: 0, citedCount: 0, viewCount: 0 },
      post.stats || {}
    );
    const key = STAT_KEY[type];
    stats[key] = Math.max(0, (stats[key] || 0) + delta);

    await t.collection(COL.posts).doc(targetId).update({
      data: { stats, updatedAt: db.serverDate() },
    });

    await t.commit();
    return { active: !existed, count: stats[key], post, stats };
  } catch (e) {
    try {
      await t.rollback();
    } catch (e2) { /* 事务可能已自动回滚 */ }
    throw e;
  }
}

/**
 * 撤回/修正合并消息：帖子计数归零 → 删除消息；否则把正文里的人数改成当前计数
 * （msg.js 在 25 个云函数里各有一份，撤回逻辑只此处需要，故写在这里）
 */
async function retractMessage(dedupeKey, post, isLike, count) {
  const res = await coll(COL.messages).where({ dedupeKey, toUid: post.authorUid }).limit(1).get();
  const m = res.data && res.data[0];
  if (!m) return;
  if (count <= 0) {
    await coll(COL.messages).doc(m._id).remove();
    return;
  }
  const title = excerpt(post.title || post.content || '你的分享', 20);
  await coll(COL.messages).doc(m._id).update({
    data: {
      count: Math.max(1, (m.count || 1) - 1),
      body: isLike
        ? `《${title}》等 ${count} 人赞了你的分享`
        : `《${title}》等 ${count} 人收藏了你的分享`,
    },
  });
}

exports.main = withAuth(async (event, ctx) => {
  const targetType = String(event.targetType || 'post');
  const targetId = String(event.targetId || '').trim();
  const type = String(event.type || '');

  if (targetType !== 'post') return fail(40001, '暂不支持该对象的互动');
  if (!targetId) return fail(40001, '缺少目标 ID');
  if (type !== 'like' && type !== 'fav') return fail(40001, '不支持的互动类型');

  const id = interId(ctx.uid, targetType, targetId, type);

  let result = null;
  let lastErr = null;
  for (let i = 0; i <= MAX_RETRY; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await toggleOnce(id, ctx.uid, targetType, targetId, type);
      break;
    } catch (e) {
      lastErr = e;
      // 事务写冲突：短暂退避后重试
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 60 * (i + 1)));
    }
  }

  if (!result) {
    console.error('[interactionToggle] conflict', lastErr && lastErr.message);
    return fail(40902);
  }
  if (result.error) return result.error;

  // 写消息：只在「新增」时发，且不给自己发（必须 await，否则容器冻结丢写）
  if (result.active && result.post.authorUid && result.post.authorUid !== ctx.uid) {
    const title = excerpt(result.post.title || result.post.content || '你的分享', 20);
    const isLike = type === 'like';
    await msg
      .push({
        toUid: result.post.authorUid,
        type: isLike ? 'like' : 'fav',
        title: isLike ? '收到新的赞' : '收到新的收藏',
        body: isLike
          ? `《${title}》等 ${result.count} 人赞了你的分享`
          : `《${title}》等 ${result.count} 人收藏了你的分享`,
        refType: 'post',
        refId: targetId,
        dedupeKey: isLike ? msg.likeDedupeKey(targetId) : msg.favDedupeKey(targetId),
      })
      .catch(() => {});
  }

  // 取消赞/藏：撤回当天合并的那条消息，否则「点了又取消」后帖子 0 赞却留着「有人赞了你」
  if (!result.active && result.post.authorUid && result.post.authorUid !== ctx.uid) {
    const isLike = type === 'like';
    await retractMessage(
      isLike ? msg.likeDedupeKey(targetId) : msg.favDedupeKey(targetId),
      result.post,
      isLike,
      result.count
    ).catch(() => {});
  }

  return ok({ active: result.active, count: result.count });
}, { write: true });
