/**
 * taskHotScore（9.22，每小时）
 * 重算近 7 天 published 帖子热度；顺带把超过 expireDays 的帖子标记 expired
 */
const { coll, _, COL, db, ms } = require('./lib/db');
const { getConfig } = require('./lib/config');
const { hotScore } = require('./lib/hot');

const PAGE = 100;      // 单次 get 上限 100（云函数内可到 1000，取小值降低内存）
const MAX_ROUNDS = 10; // 单次执行最多 1000 条

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

  // 过期标记：幂等写入，单次最多 200 条
  try {
    const res = await coll(COL.posts)
      .where({ status: 'published', publishedAt: _.lt(expireBefore), expired: _.neq(true) })
      .field({ _id: true })
      .limit(200)
      .get();
    const list = res.data || [];
    for (const p of list) {
      // eslint-disable-next-line no-await-in-loop
      await coll(COL.posts).doc(p._id).update({ data: { expired: true, expiredAt: db.serverDate() } });
      expired += 1;
    }
  } catch (e) {
    console.warn('[taskHotScore] expire failed', e && e.message);
  }

  console.log('[taskHotScore]', JSON.stringify({ scanned, updated, expired, fails: fails.length }));
  return { ok: true, scanned, updated, expired, at: ms(new Date()) };
};
