/**
 * taskVectorize（9.22，每 5 分钟）
 * 兜底：找 published 但还没有 vectors 记录的帖子（≤50 条/次）→ 调 aiEmbed
 */
const { cloud, coll, _, COL, ms } = require('./lib/db');

const BATCH = 50;
const SCAN = 100;

exports.main = async () => {
  let posts = [];
  try {
    const res = await coll(COL.posts)
      .where({ status: 'published' })
      .field({ title: true, aiSummary: true, publishedAt: true })
      .orderBy('createdAt', 'desc')
      .limit(SCAN)
      .get();
    posts = res.data || [];
  } catch (e) {
    console.error('[taskVectorize] query failed', e && e.message);
    return { ok: false, msg: 'query failed' };
  }
  if (!posts.length) return { ok: true, total: 0, done: 0 };

  const ids = posts.map((p) => p._id);
  const has = {};
  try {
    const res = await coll(COL.vectors)
      .where({ postId: _.in(ids) })
      .field({ postId: true })
      .limit(SCAN)
      .get();
    (res.data || []).forEach((v) => { has[v.postId] = true; });
  } catch (e) { /* 集合不存在时全部当作缺失 */ }

  const todo = posts.filter((p) => !has[p._id]).slice(0, BATCH);
  let done = 0;
  const fails = [];

  for (const p of todo) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await cloud.callFunction({ name: 'aiEmbed', data: { postId: p._id } });
      const res = (r && r.result) || {};
      if (res.ok) done += 1;
      else fails.push(p._id);
    } catch (e) {
      fails.push(p._id);
    }
  }

  console.log('[taskVectorize]', JSON.stringify({ scanned: posts.length, todo: todo.length, done, fails: fails.length }));
  return { ok: true, scanned: posts.length, done, fails: fails.length, at: ms(new Date()) };
};
