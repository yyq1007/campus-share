/**
 * postDetail（9.5）
 * 非 published 仅作者可见；authorUid 不下发；citedCount 仅作者可见
 */
const { coll, _, COL, ms } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { postFull } = require('./lib/present');
const { getConfig } = require('./lib/config');

exports.main = withAuth(async (event, ctx) => {
  const id = String(event.id || '').trim();
  const sid = String(event.sid || '').trim();
  if (!id && !sid) return fail(40001);

  let res;
  try {
    res = id
      ? await coll(COL.posts).doc(id).get()
      : await coll(COL.posts).where({ shortId: sid }).limit(1).get();
  } catch (e) {
    return fail(40401);
  }

  const post = id ? (res && res.data) : (res.data && res.data[0]);
  if (!post) return fail(40401);

  const isMine = post.authorUid === ctx.uid;
  if (post.status !== 'published' && !isMine) return fail(40402);
  if (post.status === 'deleted') return fail(40401);

  const config = await getConfig();
  const expireDays = (config.hot && config.hot.expireDays) || 90;
  if (!post.expired && post.publishedAt && Date.now() - ms(post.publishedAt) > expireDays * 86400000) {
    post.expired = true;
  }

  // 浏览数自增：await 但不阻塞失败（SCF 返回后容器冻结，未 await 会丢）
  if (post.status === 'published') {
    await coll(COL.posts).doc(post._id).update({ data: { 'stats.viewCount': _.inc(1) } }).catch(() => {});
  }

  let myInteraction = { liked: false, faved: false };
  try {
    const ir = await coll(COL.interactions)
      .where({ uid: ctx.uid, targetType: 'post', targetId: post._id })
      .get();
    (ir.data || []).forEach((it) => {
      if (it.type === 'like') myInteraction.liked = true;
      if (it.type === 'fav') myInteraction.faved = true;
    });
  } catch (e) { /* ignore */ }

  return ok({
    post: postFull(post, isMine),
    isMine,
    myInteraction,
    commentTotal: (post.stats && post.stats.commentCount) || 0,
  });
}, {});
