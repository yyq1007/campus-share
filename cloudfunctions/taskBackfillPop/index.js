/**
 * taskBackfillPop（11.11，一次性工具，跑完可删除）
 * 回填 posts.popScore = 3×likeCount + 4×favCount
 *
 * 为什么要它：popScore 是排行榜新增字段，上线前已存在的帖子没有该字段，
 * 排序时 null 位置不确定 → 榜单错乱。上线流程里必须跑一次本函数。
 *
 * 用法（云开发控制台 → 云函数 → 测试）：
 *   第 1 次 {"cursor": 0} → 返回 nextCursor
 *   第 2 次 {"cursor": <上一步的 nextCursor>} → …直到 done = true
 * 每批 300 条（逐条 update，约 3s，远低于 20s 超时）。
 */
const { coll, _, COL } = require('./lib/db');

exports.main = async (event) => {
  const cursor = Number(event.cursor) || 0;
  const limit = Math.min(Number(event.limit) || 300, 500);

  let rows = [];
  try {
    const res = await coll(COL.posts)
      .where({ status: _.neq('deleted') })
      .field({ stats: true })
      .skip(cursor)
      .limit(limit)
      .get();
    rows = res.data || [];
  } catch (e) {
    console.error('[taskBackfillPop] query failed', e && e.message);
    return { ok: false, error: (e && e.message) || 'query failed', cursor };
  }

  let updated = 0;
  const fails = [];

  for (const p of rows) {
    const s = p.stats || {};
    const popScore = 3 * (s.likeCount || 0) + 4 * (s.favCount || 0);
    try {
      // eslint-disable-next-line no-await-in-loop
      await coll(COL.posts).doc(p._id).update({ data: { popScore } });
      updated += 1;
    } catch (e) {
      fails.push(p._id);
    }
  }

  const done = rows.length < limit;
  console.log('[taskBackfillPop]', JSON.stringify({ cursor, scanned: rows.length, updated, done, fails: fails.length }));
  return {
    ok: true,
    scanned: rows.length,
    updated,
    nextCursor: cursor + rows.length,
    done,
  };
};
