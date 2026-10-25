/**
 * commentList（9.8）
 * 不传 parentId：一级评论（floor desc），每条内嵌最多 3 条回复
 * 传 parentId：返回该评论下全部回复
 */
const { coll, _, COL, decodeCursor, encodeCursor } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { commentItem } = require('./lib/present');

exports.main = withAuth(async (event, ctx) => {
  const postId = String(event.postId || '');
  const parentId = String(event.parentId || '');
  if (!postId) return fail(40001);
  const pageSize = Math.max(1, Math.min(Number(event.pageSize) || 20, 50));

  if (parentId) {
    const res = await coll(COL.comments)
      .where({ postId, parentId, status: 'published' })
      .orderBy('createdAt', 'asc')
      .limit(pageSize)
      .get();
    const replies = (res.data || []).filter((c) => c.status === 'published' || c.authorUid === ctx.uid);
    return ok({ list: replies.map((r) => commentItem(r, [], ctx.uid)), nextCursor: null, hasMore: false, total: replies.length });
  }

  const where = { postId, parentId: _.in(['', null]) };
  const statusOr = ctx.uid
    ? _.or([{ status: 'published' }, { status: 'pending', authorUid: ctx.uid }])
    : { status: 'published' };

  let res;
  try {
    res = await coll(COL.comments)
      .where(_.and([where, statusOr]))
      .orderBy('floor', 'desc')
      .limit(pageSize)
      .get();
  } catch (e) {
    // 无 parentId 字段的历史数据兜底
    res = await coll(COL.comments)
      .where({ postId, status: 'published' })
      .orderBy('floor', 'desc')
      .limit(pageSize)
      .get();
  }

  const rows = res.data || [];
  const ids = rows.map((r) => r._id);

  let replyMap = {};
  if (ids.length) {
    try {
      const rr = await coll(COL.comments)
        .where({ postId, parentId: _.in(ids), status: 'published' })
        .orderBy('createdAt', 'asc')
        .limit(200)
        .get();
      (rr.data || []).forEach((r) => {
        replyMap[r.parentId] = replyMap[r.parentId] || [];
        if (replyMap[r.parentId].length < 3) replyMap[r.parentId].push(r);
      });
    } catch (e) { /* ignore */ }
  }

  let total = 0;
  try {
    const c = await coll(COL.comments).where({ postId, status: 'published' }).count();
    total = c.total || 0;
  } catch (e) {
    total = rows.length;
  }

  return ok({
    list: rows.map((r) => commentItem(r, replyMap[r._id] || [], ctx.uid)),
    nextCursor: null,
    hasMore: false,
    total,
  });
}, {});
