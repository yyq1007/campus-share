/**
 * commentList（9.8）
 * 不传 parentId：一级评论（floor desc，游标 = 上一页最后的楼层号），每条内嵌最多 3 条回复
 * 传 parentId：返回该评论下全部回复
 * 身份标签 tag：'op' 楼主（帖子作者）/ 'layer' 层主（被回复的一级评论作者）/ '' 其他匿名同学
 *   —— 在读取时计算，只下发标签不下发 authorUid
 */
const { coll, _, COL, decodeCursor, encodeCursor } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { commentItem } = require('./lib/present');

async function loadPostAuthor(postId) {
  try {
    const r = await coll(COL.posts).doc(postId).field({ authorUid: true }).get();
    return (r.data && r.data.authorUid) || '';
  } catch (e) {
    return '';
  }
}

function tagOf(authorUid, opUid, layerUid) {
  if (!authorUid) return '';
  if (opUid && authorUid === opUid) return 'op';
  if (layerUid && authorUid === layerUid) return 'layer';
  return '';
}

/** commentItem 不带 authorUid，这里按原始数据补上身份标签 */
function withTags(item, raw, rawReplies, opUid) {
  item.tag = tagOf(raw.authorUid, opUid, '');
  item.replies.forEach((r, i) => {
    r.tag = tagOf(rawReplies[i] && rawReplies[i].authorUid, opUid, raw.authorUid);
  });
  return item;
}

exports.main = withAuth(async (event, ctx) => {
  const postId = String(event.postId || '');
  const parentId = String(event.parentId || '');
  if (!postId) return fail(40001);
  const pageSize = Math.max(1, Math.min(Number(event.pageSize) || 20, 50));
  const cursor = decodeCursor(event.cursor);
  // 作者本人能看到自己待审核的评论和回复，否则发完重进就「消失」了
  const statusOr = ctx.uid
    ? _.or([{ status: 'published' }, { status: 'pending', authorUid: ctx.uid }])
    : { status: 'published' };

  if (parentId) {
    const [res, pr, opUid] = await Promise.all([
      coll(COL.comments)
        .where(_.and([{ postId, parentId }, statusOr]))
        .orderBy('createdAt', 'asc')
        .limit(pageSize)
        .get(),
      coll(COL.comments).doc(parentId).field({ authorUid: true }).get().catch(() => ({ data: null })),
      loadPostAuthor(postId),
    ]);
    const layerUid = (pr.data && pr.data.authorUid) || '';
    const replies = res.data || [];
    const list = replies.map((r) => Object.assign(commentItem(r, [], ctx.uid), { tag: tagOf(r.authorUid, opUid, layerUid) }));
    return ok({ list, nextCursor: null, hasMore: false, total: replies.length });
  }

  const where = { postId, parentId: _.in(['', null]) };
  if (cursor && cursor.f) where.floor = _.lt(Number(cursor.f));

  // 与一级评论查询同时发出，缩短整体耗时
  const opTask = loadPostAuthor(postId);
  const totalTask = coll(COL.comments)
    .where(_.and([{ postId }, statusOr]))
    .count()
    .then((c) => c.total || 0)
    .catch(() => null);

  let res;
  try {
    res = await coll(COL.comments)
      .where(_.and([where, statusOr]))
      .orderBy('floor', 'desc')
      .limit(pageSize + 1)
      .get();
  } catch (e) {
    // 无 parentId 字段的历史数据兜底
    const fallback = { postId, status: 'published' };
    if (where.floor) fallback.floor = where.floor;
    res = await coll(COL.comments)
      .where(fallback)
      .orderBy('floor', 'desc')
      .limit(pageSize + 1)
      .get();
  }

  const hasMore = (res.data || []).length > pageSize;
  const rows = (res.data || []).slice(0, pageSize);
  const ids = rows.map((r) => r._id);

  let replyMap = {};
  if (ids.length) {
    try {
      const rr = await coll(COL.comments)
        .where(_.and([{ postId, parentId: _.in(ids) }, statusOr]))
        .orderBy('createdAt', 'asc')
        .limit(200)
        .get();
      (rr.data || []).forEach((r) => {
        replyMap[r.parentId] = replyMap[r.parentId] || [];
        if (replyMap[r.parentId].length < 3) replyMap[r.parentId].push(r);
      });
    } catch (e) { /* ignore */ }
  }

  const [opUid, counted] = await Promise.all([opTask, totalTask]);
  const total = counted === null ? rows.length : counted;

  return ok({
    list: rows.map((r) => withTags(commentItem(r, replyMap[r._id] || [], ctx.uid), r, replyMap[r._id] || [], opUid)),
    nextCursor: hasMore && rows.length ? encodeCursor({ f: rows[rows.length - 1].floor }) : null,
    hasMore,
    total,
  });
}, {});
