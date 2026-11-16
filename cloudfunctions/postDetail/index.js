/**
 * postDetail（9.5）
 * 非 published 仅作者可见；authorUid 不下发；citedCount 仅作者可见
 */
const { coll, _, COL, ms, cloud } = require('./lib/db');
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

  // 周报帖：附带往期周报（最多 10 篇，按发布时间倒序，不含当前这篇）
  // 前端渲染成「往期周报」列表，点击跳对应周报详情
  let pastDigests = [];
  if (post.isDigest) {
    try {
      const pr = await coll(COL.posts)
        .where({ status: 'published', board: 'digest', _id: _.neq(post._id) })
        .orderBy('publishedAt', 'desc')
        .limit(10)
        .field({ _id: true, itemCount: true, publishedAt: true })
        .get();
      pastDigests = (pr.data || []).map((p) => ({
        id: p._id,
        itemCount: p.itemCount || 0,
        publishedAt: ms(p.publishedAt),
      }));
    } catch (e) { /* 查询失败不阻塞详情返回 */ }
  }

  // 作者公开信息（2026-11-16 起所有人可见）：昵称+头像临时链接，不下发 authorUid
  let author = null;
  try {
    const ar = await coll(COL.users).where({ _id: post.authorUid }).field({ nickname: true, avatar: true }).limit(1).get();
    const u = ar.data && ar.data[0];
    if (u) {
      const av = u.avatar || {};
      let avatarUrl = '';
      if (av.fileId && av.status !== 'risky') {
        try {
          const tr = await cloud.getTempFileURL({ fileList: [av.fileId] });
          const f = tr.fileList && tr.fileList[0];
          if (f && f.tempFileURL) avatarUrl = f.tempFileURL;
        } catch (e) { /* 链接失败降级为空 */ }
      }
      author = { nickname: String(u.nickname || '').trim(), avatarUrl };
    }
  } catch (e) { /* 解析失败降级为匿名 */ }

  const full = postFull(post, isMine);
  full.author = author;
  return ok({
    post: full,
    isMine,
    myInteraction,
    commentTotal: (post.stats && post.stats.commentCount) || 0,
    pastDigests,
  });
}, {});
