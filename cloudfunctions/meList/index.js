/**
 * meList（9.14）
 * type=posts：本人全部状态（含 pending/rejected/hidden）+ citedCount 仅本人可见
 * type=favorites：收藏的帖子（postBrief，带 liked/faved 状态）
 * type=messages：站内消息 + 三个 Tab 的未读数
 */
const { coll, _, COL, decodeCursor, encodeCursor, ms } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { postBrief } = require('./lib/present');

const MAX_PAGE = 20;
const MSG_TYPES = {
  comment: ['comment', 'reply', 'expiry'],
  social: ['like', 'fav'],
};

function clampSize(v) {
  const n = Number(v) || 20;
  return Math.max(1, Math.min(n, MAX_PAGE));
}

async function listPosts(ctx, tab, cursor, pageSize) {
  const where = { authorUid: ctx.uid };
  if (tab === 'pending') where.status = 'pending';
  else where.status = _.neq('deleted');
  if (cursor) where.createdAt = _.lt(new Date(cursor.t));

  const res = await coll(COL.posts)
    .where(where)
    .field({
      title: true, excerpt: true, coverFileId: true, media: true, status: true,
      createdAt: true, publishedAt: true, board: true, stats: true, expired: true,
    })
    .orderBy('createdAt', 'desc')
    .limit(pageSize + 1)
    .get();

  const rows = res.data || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);

  const list = page.map((p) => {
    const first = (p.media || [])[0] || {};
    return {
      id: p._id,
      title: p.title || '',
      excerpt: p.excerpt || '',
      cover: p.coverFileId || first.posterFileId || first.fileId || '',
      board: p.board,
      status: p.status === 'published' && p.expired ? 'expired' : p.status,
      citedCount: (p.stats && p.stats.citedCount) || 0,
      createdAt: ms(p.createdAt),
    };
  });

  return {
    list,
    hasMore,
    nextCursor: hasMore && page.length ? encodeCursor({ t: ms(page[page.length - 1].createdAt) }) : null,
  };
}

async function listFavorites(ctx, cursor, pageSize) {
  const where = { uid: ctx.uid, type: 'fav' };
  if (cursor) where.createdAt = _.lt(new Date(cursor.t));

  const res = await coll(COL.interactions)
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(pageSize + 1)
    .get();

  const rows = res.data || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);

  const ids = page.map((r) => r.targetId).filter(Boolean);
  let posts = [];
  if (ids.length) {
    const pr = await coll(COL.posts)
      .where({ _id: _.in(ids), status: 'published' })
      .limit(50)
      .get();
    posts = pr.data || [];
  }
  const map = {};
  posts.forEach((p) => { map[p._id] = p; });

  // 按收藏时间排序，已删除的帖子直接跳过
  const list = page
    .map((r) => {
      const p = map[r.targetId];
      if (!p) return null;
      return postBrief(p, { faved: true, liked: false });
    })
    .filter(Boolean);

  return {
    list,
    hasMore,
    nextCursor: hasMore && page.length ? encodeCursor({ t: ms(page[page.length - 1].createdAt) }) : null,
  };
}

async function listMessages(ctx, tab, cursor, pageSize) {
  const where = { toUid: ctx.uid };
  if (MSG_TYPES[tab]) where.type = _.in(MSG_TYPES[tab]);
  if (cursor) where.createdAt = _.lt(new Date(cursor.t));

  const res = await coll(COL.messages)
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(pageSize + 1)
    .get();

  const rows = res.data || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);

  const list = page.map((m) => ({
    id: m._id,
    type: m.type,
    title: m.title || '',
    body: m.body || '',
    count: m.count || 1,
    read: !!m.read,
    refType: m.refType || 'post',
    refId: m.refId || '',
    createdAt: ms(m.createdAt),
  }));

  const counts = { all: 0, comment: 0, social: 0 };
  try {
    const [all, comment, social] = await Promise.all([
      coll(COL.messages).where({ toUid: ctx.uid, read: false }).count(),
      coll(COL.messages).where({ toUid: ctx.uid, read: false, type: _.in(MSG_TYPES.comment) }).count(),
      coll(COL.messages).where({ toUid: ctx.uid, read: false, type: _.in(MSG_TYPES.social) }).count(),
    ]);
    counts.all = all.total || 0;
    counts.comment = comment.total || 0;
    counts.social = social.total || 0;
  } catch (e) { /* 计数失败不阻断列表 */ }

  return {
    list,
    counts,
    hasMore,
    nextCursor: hasMore && page.length ? encodeCursor({ t: ms(page[page.length - 1].createdAt) }) : null,
  };
}

exports.main = withAuth(async (event, ctx) => {
  const type = String(event.type || 'posts');
  const tab = String(event.tab || 'all');
  const pageSize = clampSize(event.pageSize);
  const cursor = decodeCursor(event.cursor);

  try {
    if (type === 'posts') return ok(await listPosts(ctx, tab, cursor, pageSize));
    if (type === 'favorites') return ok(await listFavorites(ctx, cursor, pageSize));
    if (type === 'messages') return ok(await listMessages(ctx, tab, cursor, pageSize));
  } catch (e) {
    console.error('[meList]', e && (e.message || e));
    return fail(50001);
  }
  return fail(40001, '不支持的类型');
}, {});
