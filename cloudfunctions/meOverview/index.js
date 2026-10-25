/**
 * meOverview（9.13）
 * 我的页聚合：身份、统计、未读、配置；pendingCount 仅 admin 返回
 */
const { coll, _, $, COL } = require('./lib/db');
const { ok } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { getConfig } = require('./lib/config');
const msg = require('./lib/msg');
const { ensureUserCode } = require('./lib/invite');

async function countPosts(uid) {
  try {
    const c = await coll(COL.posts).where({ authorUid: uid, status: _.neq('deleted') }).count();
    return c.total || 0;
  } catch (e) {
    return 0;
  }
}

async function countFavs(uid) {
  try {
    const c = await coll(COL.interactions).where({ uid, type: 'fav' }).count();
    return c.total || 0;
  } catch (e) {
    return 0;
  }
}

async function sumCited(uid) {
  try {
    const res = await coll(COL.posts)
      .aggregate()
      .match({ authorUid: uid, status: 'published' })
      .group({ _id: null, total: $.sum('$stats.citedCount') })
      .end();
    const row = (res.list || [])[0];
    return (row && row.total) || 0;
  } catch (e) {
    return 0;
  }
}

exports.main = withAuth(async (event, ctx) => {
  const [posts, favs, cited, unread, config] = await Promise.all([
    countPosts(ctx.uid),
    countFavs(ctx.uid),
    sumCited(ctx.uid),
    msg.unreadCount(ctx.uid),
    getConfig(),
  ]);

  const data = {
    uid: ctx.uid,
    anonNo: ctx.user.anonNo || '',
    role: ctx.role,
    status: ctx.status,
    credit: ctx.credit,
    avatar: ctx.user.avatar || null,
    nickname: ctx.user.nickname || '',
    inviteCode: ctx.user.inviteCode ? await ensureUserCode(ctx.user) : '',
    stats: { posts, favs, cited },
    unread,
    canRevoke: ctx.status === 'deactivating',
    config,
  };

  if (ctx.role === 'admin') {
    try {
      const c = await coll(COL.reviewQueue).where({ status: 'pending' }).count();
      data.pendingCount = c.total || 0;
    } catch (e) {
      data.pendingCount = 0;
    }
  }

  return ok(data);
}, {});
