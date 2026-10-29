/**
 * taskHotScore（9.22，每小时）
 * 重算近 7 天 published 帖子热度；顺带把超过 expireDays 的帖子标记 expired
 *
 * ⚠️ B13 修复：原来两处有硬上限，帖子量一多就漏：
 *   1. 热度扫描 MAX_ROUNDS=10 × PAGE=100 = 1000 条 → 近 7 天超 1000 条时算不全
 *   2. 过期标记 limit(200) → 超 200 条的老帖子不会被标 expired（一直挂在首页）
 * 现在：热度扫描上限提到 5000 条（每小时的定时任务，够用）；
 *      过期标记改用分批更新（batchUpdate），不再有单次 200 条限制。
 */
const { coll, _, COL, db, ms, batchUpdate } = require('./lib/db');
const { getConfig } = require('./lib/config');
const { hotScore } = require('./lib/hot');

const PAGE = 100;         // 单次 get 上限 100（云函数内可到 1000，取小值降低内存）
const MAX_ROUNDS = 50;    // 单次执行最多 5000 条（原来 10 轮 = 1000 条）
const EXPIRE_BATCH = 100; // 过期标记每批条数

exports.main = async (event) => {
  const config = await getConfig();
  const expireDays = (config.hot && config.hot.expireDays) || 90;
  const now = Date.now();
  const since = new Date(now - 7 * 86400000);
  const expireBefore = new Date(now - expireDays * 86400000);

  let scanned = 0;
  let updated = 0;
  let expired = 0;
  const fails = [];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let rows = [];
    try {
      const res = await coll(COL.posts)
        .where({ status: 'published', publishedAt: _.gte(since) })
        .field({ stats: true, publishedAt: true, hotScore: true })
        .orderBy('publishedAt', 'desc')
        .skip(round * PAGE)
        .limit(PAGE)
        .get();
      rows = res.data || [];
    } catch (e) {
      console.error('[taskHotScore] query failed', e && e.message);
      break;
    }
    if (!rows.length) break;
    scanned += rows.length;

    for (const p of rows) {
      const score = hotScore(p.stats || {}, p.publishedAt, now);
      if (Math.abs(score - (p.hotScore || 0)) < 0.01) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await coll(COL.posts).doc(p._id).update({ data: { hotScore: score } });
        updated += 1;
      } catch (e) {
        fails.push(p._id);
      }
    }

    if (rows.length < PAGE) break;
  }

  // 过期标记：幂等写入。
  // ⚠️ 原来用 limit(200) 单次取，超 200 条的老帖子不会被标记 expired
  //    （过期帖一直挂在首页/板块页）。改用分批更新，不再有单次条数限制。
  //    where 里带上 expired != true，只处理还没标记过的（普通字段用 $ne 没问题），
  //    避免重复扫已过期的帖子导致计数虚高。
  try {
    expired = await batchUpdate(
      COL.posts,
      { status: 'published', publishedAt: _.lt(expireBefore), expired: _.neq(true) },
      { expired: true, expiredAt: db.serverDate() },
      { batchSize: EXPIRE_BATCH }
    );
  } catch (e) {
    console.warn('[taskHotScore] expire failed', e && e.message);
  }

  console.log('[taskHotScore]', JSON.stringify({ scanned, updated, expired, fails: fails.length }));
  return { ok: true, scanned, updated, expired, at: ms(new Date()) };
};
