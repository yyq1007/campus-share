/**
 * rankList（11.11 新增）
 * 排行榜：热度榜（长期累计赞藏）/ 板块榜（同口径，按 board 切）/ 新秀榜（近 7 天，按 hotScore）
 *
 * 口径：
 *   热度榜 = 3×likeCount + 4×favCount（posts.popScore，由 interactionToggle 在事务内维护）
 *   新秀榜 = posts.hotScore（taskHotScore 每小时重算，自带时间衰减，对新鲜内容公平）
 *
 * 约束：
 *   - 强制 status=published；热度/板块榜过滤 popScore<=0（无人赞藏的帖不上榜）
 *   - 不下发 authorUid（榜单只表彰内容，与匿名定位一致）
 *   - cover 保持云存储 fileID，由前端 api.js 统一转临时链接
 */
const { coll, _, COL } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { postBrief } = require('./lib/present');

const LIMIT = 50;
const FRESH_DAYS = 7;
const BOARDS = ['food', 'life', 'study'];

exports.main = withAuth(async (event) => {
  const type = String(event.type || 'hot');
  const board = String(event.board || '');

  const where = { status: 'published' };
  let orderField = 'popScore';

  if (type === 'fresh') {
    // 新秀榜：只看近 7 天发布的帖子，按带衰减的 hotScore 排
    where.publishedAt = _.gte(new Date(Date.now() - FRESH_DAYS * 86400000));
    orderField = 'hotScore';
  } else if (type === 'board') {
    if (BOARDS.indexOf(board) === -1) return fail(40001, '板块参数不合法');
    where.board = board;
    where.popScore = _.gt(0);
  } else {
    where.popScore = _.gt(0);
  }

  let res;
  try {
    res = await coll(COL.posts)
      .where(where)
      .orderBy(orderField, 'desc')
      // 第二排序键：同分（大量 0 分/同热度帖）时顺序稳定，避免每次刷新名次乱跳
      .orderBy('publishedAt', 'desc')
      .limit(LIMIT)
      .get();
  } catch (e) {
    console.error('[rankList query]', e && (e.message || e));
    return fail(50001);
  }

  const list = (res.data || []).map((p, i) => Object.assign(postBrief(p), {
    rank: i + 1,
    score: type === 'fresh' ? (p.hotScore || 0) : (p.popScore || 0),
  }));

  return ok({ list, type, board, updatedAt: Date.now() });
}, {});
