/**
 * taskVectorize（9.22，每 5 分钟）
 * 兜底：找 published 但还没有 vectors 记录的帖子 → 调 aiEmbed
 *
 * ⚠️ B12 修复：原实现固定查「最新 100 条」再过滤掉已向量化的。
 * 问题不在于「只看 100 条」，而在于**已向量化的帖子会一直占据这 100 条的名额**
 * —— 最新 100 条都处理完后，这 100 条不会消失，下一轮还是它们，
 * 排在第 101 条及以后的旧帖子永远轮不到 → 越老的帖子越搜不到（askQuery 召回率受损）。
 *
 * 现在改为「服务端标记 + 游标推进」：
 *   - postCreate 建帖时写 embedded: false，aiEmbed 成功后置 true
 *     查询直接命中 embedded != true 的帖子，不需要先查 100 条再过滤
 *     （历史数据没有 embedded 字段，$ne(true) 同样能命中，符合预期）
 *   - 用 posts.createdAt 做游标逐页推进（_.lt 严格小于），一轮扫完全部
 *     已向量化的帖子被 where 过滤掉，不会重复占用名额
 *
 * 注：不做「扫到底后绕回开头」——游标推进已经保证一轮覆盖全部，
 * 绕回只会用相同条件重复扫同一批（scanned 虚高 + 白跑查询）。
 */
const { cloud, coll, _, COL, ms } = require('./lib/db');

const BATCH = 50;      // 单次最多向量化多少条
const PAGE = 100;      // 单页扫描多少条
const MAX_ROUNDS = 20; // 单次运行最多扫多少页（20 × 100 = 2000 条，防异常状态下无限循环）

exports.main = async () => {
  const now = ms(new Date());
  let scanned = 0;
  const todo = [];
  let cursor = null; // 游标：上一页最老一条的 createdAt

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // 只捞「还没向量化」的帖子：embedded 字段缺失（旧数据）或为 false
    const where = { status: 'published', embedded: _.neq(true) };
    if (cursor) where.createdAt = _.lt(new Date(cursor));

    let posts = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await coll(COL.posts)
        .where(where)
        .field({ title: true, aiSummary: true, publishedAt: true, createdAt: true })
        .orderBy('createdAt', 'desc')
        .limit(PAGE)
        .get();
      posts = res.data || [];
    } catch (e) {
      console.error('[taskVectorize] query failed', e && e.message);
      return { ok: false, msg: 'query failed', scanned };
    }

    if (!posts.length) break;      // 没有更多待向量化的帖子
    scanned += posts.length;
    todo.push(...posts);

    // 推进游标到本页最老的一条（下一页只取比它更老的 → 不重复）
    cursor = ms(posts[posts.length - 1].createdAt);

    if (posts.length < PAGE) break; // 不足一页 → 已扫到底
  }

  if (!todo.length) return { ok: true, scanned: 0, todo: 0, done: 0, fails: 0, at: now };

  // 兜底：万一 embedded 标记不可靠（历史数据没写这个字段），
  // 再查一次 vectors 排除已向量化的，避免重复计算
  const ids = todo.map((p) => p._id);
  const has = {};
  try {
    const res = await coll(COL.vectors)
      .where({ postId: _.in(ids) })
      .field({ postId: true })
      .limit(ids.length)
      .get();
    (res.data || []).forEach((v) => { has[v.postId] = true; });
  } catch (e) { /* 集合不存在时全部当作缺失 */ }

  const list = todo.filter((p) => !has[p._id]).slice(0, BATCH);
  let done = 0;
  const fails = [];

  for (const p of list) {
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

  console.log('[taskVectorize]', JSON.stringify({ scanned, todo: list.length, done, fails: fails.length }));
  return { ok: true, scanned, todo: list.length, done, fails: fails.length, at: now };
};
