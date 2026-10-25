/**
 * adminQueue（9.16）
 * tab=pending：内容安全/AI/视频待审；tab=report：用户举报（同一目标已合并）；tab=done：已处理
 * 队列记录 join 内容快照（正文摘要、首 3 张图、板块），供审核台直接判定
 */
const { coll, _, COL, decodeCursor, encodeCursor, ms, excerpt } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');

const MAX_PAGE = 20;

function clampSize(v) {
  const n = Number(v) || 20;
  return Math.max(1, Math.min(n, MAX_PAGE));
}

async function loadTargets(rows) {
  const postIds = [];
  const commentIds = [];
  rows.forEach((r) => {
    if (r.targetType === 'post') postIds.push(r.targetId);
    else if (r.targetType === 'comment') commentIds.push(r.targetId);
  });

  const postMap = {};
  const commentMap = {};
  const tasks = [];
  if (postIds.length) {
    tasks.push(
      coll(COL.posts)
        .where({ _id: _.in(postIds) })
        .field({ board: true, title: true, content: true, media: true, status: true, authorUid: true, risk: true })
        .limit(50)
        .get()
        .then((r) => (r.data || []).forEach((p) => { postMap[p._id] = p; }))
        .catch(() => {})
    );
  }
  if (commentIds.length) {
    tasks.push(
      coll(COL.comments)
        .where({ _id: _.in(commentIds) })
        .field({ postId: true, content: true, authorUid: true, status: true })
        .limit(50)
        .get()
        .then((r) => (r.data || []).forEach((c) => { commentMap[c._id] = c; }))
        .catch(() => {})
    );
  }
  await Promise.all(tasks);

  // 评论的板块从所属帖子补
  const commentPostIds = Object.keys(commentMap).map((k) => commentMap[k].postId).filter(Boolean);
  const cPostMap = {};
  if (commentPostIds.length) {
    try {
      const r = await coll(COL.posts)
        .where({ _id: _.in(commentPostIds) })
        .field({ board: true })
        .limit(50)
        .get();
      (r.data || []).forEach((p) => { cPostMap[p._id] = p; });
    } catch (e) { /* ignore */ }
  }

  return { postMap, commentMap, cPostMap };
}

exports.main = withAuth(async (event, ctx) => {
  const tab = ['pending', 'report', 'done'].indexOf(event.tab) > -1 ? event.tab : 'pending';
  const pageSize = clampSize(event.pageSize);
  const cursor = decodeCursor(event.cursor);

  const where = {};
  if (tab === 'pending') {
    where.status = 'pending';
    where.source = _.neq('report');
  } else if (tab === 'report') {
    where.status = 'pending';
    where.source = 'report';
  } else {
    where.status = _.in(['approved', 'rejected', 'ignored']);
  }

  // 游标：待审按 priority 升序 + createdAt 升序；已处理按 updatedAt 降序
  if (cursor && tab === 'done') where.updatedAt = _.lt(new Date(cursor.t));

  let query = coll(COL.reviewQueue).where(where);
  if (tab === 'done') {
    query = query.orderBy('updatedAt', 'desc');
  } else {
    // 待审/举报：优先级小的排前面，同优先级按提交时间
    query = query.orderBy('priority', 'asc').orderBy('createdAt', 'asc');
    const skip = (cursor && cursor.skip) || 0;
    if (skip > 0) query = query.skip(skip);
  }

  let res;
  try {
    res = await query.limit(pageSize + 1).get();
  } catch (e) {
    console.error('[adminQueue]', e && (e.message || e));
    return fail(50001);
  }

  const rows = res.data || [];
  const page = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;

  const { postMap, commentMap, cPostMap } = await loadTargets(page);

  const list = page.map((q) => {
    const isComment = q.targetType === 'comment';
    const target = isComment ? commentMap[q.targetId] : postMap[q.targetId];
    const board = isComment
      ? ((cPostMap[(target && target.postId) || ''] || {}).board || '')
      : ((target && target.board) || '');
    const media = (!isComment && target && target.media ? target.media : []).slice(0, 3).map((m) => ({
      fileId: m.fileId,
      posterFileId: m.posterFileId || '',
      type: m.type,
    }));
    const text = isComment
      ? (target ? excerpt(target.content, 120) : '评论已删除')
      : (target ? `${target.title ? `${target.title}\n` : ''}${excerpt(target.content, 140)}` : '内容已删除');

    return {
      queueId: q._id,
      targetType: q.targetType,
      targetId: q.targetId,
      board,
      content: text,
      media,
      mediaType: media.length && media[0].type === 'video' ? 'video' : (media.length ? 'image' : ''),
      aiLabel: q.aiLabel || '',
      reason: q.reason || '',
      reporterReason: q.source === 'report' ? (q.reason || '') : '',
      reportCount: q.reportCount || 0,
      source: q.source,
      priority: q.priority || 5,
      status: q.status,
      reviewNote: q.reviewNote || '',
      handledBy: q.handledBy || '',
      handledAt: ms(q.reviewedAt),
      createdAt: ms(q.createdAt),
    };
  });

  const counts = { pending: 0, report: 0, done: 0 };
  try {
    const [p, r, d] = await Promise.all([
      coll(COL.reviewQueue).where({ status: 'pending', source: _.neq('report') }).count(),
      coll(COL.reviewQueue).where({ status: 'pending', source: 'report' }).count(),
      coll(COL.reviewQueue).where({ status: _.in(['approved', 'rejected', 'ignored']) }).count(),
    ]);
    counts.pending = p.total || 0;
    counts.report = r.total || 0;
    counts.done = d.total || 0;
  } catch (e) { /* ignore */ }

  let nextCursor = null;
  if (hasMore && page.length) {
    nextCursor = tab === 'done'
      ? encodeCursor({ t: ms(page[page.length - 1].updatedAt || page[page.length - 1].createdAt) })
      : encodeCursor({ skip: (cursor && cursor.skip ? cursor.skip : 0) + pageSize });
  }

  return ok({ list, counts, nextCursor, hasMore });
}, { admin: true });
