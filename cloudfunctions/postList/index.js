/**
 * postList（9.4）
 * 强制 status=published；游标分页；不返回 authorUid/openid
 */
const { coll, _, COL, decodeCursor, encodeCursor, ms } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth, resolveCtx } = require('./lib/auth');
const { postBrief } = require('./lib/present');
const { queryTokens } = require('./lib/tokenize');
const { getConfig } = require('./lib/config');

const MAX_PAGE = 20;

// interactions.type → 出参字段名。
// 数据库里存的是 'like' / 'fav'，但 present.postBrief 读的是 'liked' / 'faved'
//（与 postDetail 的 myInteraction、meList 的收藏列表口径一致）。
// 之前 postList 直接用 it.type 当键名，差一个字母 d → 永远对不上，
// 恒返回 liked=false / faved=false：前端刷新后以为没点赞过，
// 再点一次变成「取消点赞」，计数互相抵消。
const INTER_KEY = { like: 'liked', fav: 'faved' };

async function loadInteractions(uid, ids) {
  const map = {};
  if (!uid || !ids.length) return map;
  try {
    const res = await coll(COL.interactions)
      .where({ uid, targetType: 'post', targetId: _.in(ids) })
      .limit(100)
      .get();
    (res.data || []).forEach((it) => {
      const key = INTER_KEY[it.type];
      if (!key) return;
      map[it.targetId] = map[it.targetId] || {};
      map[it.targetId][key] = true;
    });
  } catch (e) { /* ignore */ }
  return map;
}

exports.main = withAuth(async (event, ctx) => {
  const board = event.board;
  if (board && ['life', 'study', 'food'].indexOf(board) === -1) return fail(40001);

  const sort = event.sort === 'latest' ? 'latest' : 'hot';
  let pageSize = Number(event.pageSize) || 10;
  pageSize = Math.max(1, Math.min(pageSize, MAX_PAGE));
  const cursor = decodeCursor(event.cursor);
  const keyword = String(event.keyword || '').trim();
  const config = await getConfig();

  const where = { status: 'published' };
  if (board) where.board = board;

  if (keyword) {
    const tokens = queryTokens(keyword);
    if (tokens.length) where.searchTokens = _.all(tokens);
  }

  if (cursor) {
    if (sort === 'latest') where.createdAt = _.lt(new Date(cursor.t));
    else where.hotScore = _.lt(cursor.h);
  }

  let query = coll(COL.posts).where(where);
  query = sort === 'latest'
    ? query.orderBy('createdAt', 'desc')
    : query.orderBy('hotScore', 'desc');

  let res;
  try {
    res = await query.skip(0).limit(pageSize + 1).get();
  } catch (e) {
    console.error('[postList query]', e && (e.message || e));
    return fail(50001);
  }

  const rows = res.data || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);

  const inter = await loadInteractions(ctx.uid, page.map((p) => p._id));
  const expireDays = (config.hot && config.hot.expireDays) || 90;

  const list = page.map((p) => {
    const brief = postBrief(p, inter[p._id]);
    if (!p.expired && p.publishedAt && Date.now() - ms(p.publishedAt) > expireDays * 86400000) {
      brief.expired = true;
    }
    return brief;
  });

  let nextCursor = null;
  if (hasMore && page.length) {
    const last = page[page.length - 1];
    nextCursor = sort === 'latest'
      ? encodeCursor({ t: ms(last.createdAt) })
      : encodeCursor({ h: last.hotScore || 0 });
  }

  const data = { list, nextCursor, hasMore };
  // total 仅首屏给出，避免每次翻页都 count
  if (!cursor) {
    try {
      const cnt = await coll(COL.posts).where(where).count();
      data.total = cnt.total || 0;
    } catch (e) {
      data.total = list.length;
    }
  }
  return ok(data);
}, {});
