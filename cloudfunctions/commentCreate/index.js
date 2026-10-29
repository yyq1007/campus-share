/**
 * commentCreate（9.9）
 * 楼层号由 posts.commentSeq 事务自增产生（C-08）；二级回复不取号
 */
const { coll, _, COL, db, charLen, normalizeText } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth, audit } = require('./lib/auth');
const { getConfig } = require('./lib/config');
const rate = require('./lib/rate');
const lex = require('./lib/lex');
const { msgSecCheck } = require('./lib/wxapi');
const msg = require('./lib/msg');

const EXPIRE_WORDS = ['关了', '没了', '倒闭', '搬走', '拆了', '失效', '停业'];

exports.main = withAuth(async (event, ctx) => {
  const postId = String(event.postId || '');
  const content = normalizeText(event.content || '');
  const parentId = String(event.parentId || '');
  const replyToFloor = Number(event.replyToFloor) || 0;
  const clientReqId = String(event.clientReqId || '');

  if (!postId) return fail(40001);
  const len = charLen(content);
  if (len < 1) return fail(40001, '说点什么再发送吧');
  if (len > 300) return fail(40002, '评论最多 300 字');
  if (!clientReqId) return fail(40001, '缺少幂等键');

  const config = await getConfig();
  const limits = config.limits || {};

  // 幂等
  try {
    const dup = await coll(COL.comments).where({ clientReqId, authorUid: ctx.uid }).limit(1).get();
    if (dup.data && dup.data.length) {
      const c = dup.data[0];
      return ok({ commentId: c._id, floor: c.floor, status: c.status, parentId: c.parentId || '', replyToFloor: c.replyToFloor || 0, isMine: true });
    }
  } catch (e) { /* ignore */ }

  const rl = await rate.hit(ctx.uid, 'commentCreate', limits.commentPer10min || 10, 10 * 60 * 1000);
  if (!rl.allowed) return fail(42901);

  // 目标帖
  let post;
  try {
    const r = await coll(COL.posts).doc(postId).get();
    post = r.data;
  } catch (e) {
    return fail(40401);
  }
  if (!post || post.status === 'deleted') return fail(40401);
  if (post.status !== 'published' && post.authorUid !== ctx.uid) return fail(40401);

  // 二级回复：必须是同帖的一级评论
  let parent = null;
  if (parentId) {
    try {
      const pr = await coll(COL.comments).doc(parentId).get();
      parent = pr.data;
    } catch (e) {
      return fail(40401);
    }
    if (!parent || parent.postId !== postId) return fail(40001, '回复目标不存在');
    if (parent.parentId) return fail(40001, '只支持两级评论');
  }

  // 内容安全
  const lexRes = await lex.check(content);
  let status = 'published';
  if (lexRes.reject) {
    // 评论命中直接驳回：不入库，只写审计
    await audit(ctx.uid, 'lexicon_block', 'comment', postId, { status: 'none' }, { status: 'rejected' }, lexRes.categories.join(','));
    return fail(40010, undefined, { ranges: lexRes.ranges });
  }
  const wxRes = await msgSecCheck(content, ctx.openid);
  if (lexRes.review || wxRes.suggest !== 'pass') status = 'pending';

  // 事务：楼层号 + 计数
  let floor = 0;
  let commentId = '';
  const t = await db.startTransaction();
  try {
    const p = await t.collection(COL.posts).doc(postId).get();
    const postPatch = { 'stats.commentCount': (p.data.stats && p.data.stats.commentCount || 0) + 1 };

    // 二级回复沿用父楼层号，不推进 commentSeq，否则下一条一级评论会跳号
    let nextFloor;
    if (parent) {
      nextFloor = parent.floor;
    } else {
      nextFloor = ((p.data && p.data.commentSeq) || 0) + 1;
      postPatch.commentSeq = nextFloor;
    }

    await t.collection(COL.posts).doc(postId).update({ data: postPatch });

    const add = await t.collection(COL.comments).add({
      data: {
        postId,
        authorUid: ctx.uid,
        floor: nextFloor,
        parentId: parentId || '',
        replyToFloor: replyToFloor || 0,
        replyCount: 0,
        content,
        status,
        risk: { level: status === 'published' ? 'pass' : 'review', source: wxRes.degraded ? 'local' : 'wx', labels: lexRes.categories, checkedAt: new Date() },
        likeCount: 0,
        clientReqId,
        createdAt: new Date(),
      },
    });
    commentId = add._id;
    floor = nextFloor;

    if (parent) {
      await t.collection(COL.comments).doc(parentId).update({
        data: { replyCount: (parent.replyCount || 0) + 1 },
      });
    }

    await t.commit();
  } catch (e) {
    try {
      await t.rollback();
    } catch (e2) { /* ignore */ }
    console.error('[commentCreate tx]', e && (e.message || e));
    return fail(50001);
  }

  // 站内消息（失败不影响返回）：必须 await，SCF 返回后容器会冻结，未 await 的写入可能丢失
  if (status === 'published') {
    const isExpiry = EXPIRE_WORDS.some((w) => content.indexOf(w) > -1);
    if (parent) {
      if (parent.authorUid && parent.authorUid !== ctx.uid) {
        await msg.push({
          toUid: parent.authorUid,
          type: 'reply',
          title: '有人回复了你的评论',
          body: `匿名 #${parent.floor}：${content.slice(0, 40)}`,
          refType: 'post',
          refId: postId,
        });
      }
      if (post.authorUid && post.authorUid !== ctx.uid && post.authorUid !== parent.authorUid) {
        await msg.push({
          toUid: post.authorUid,
          type: 'reply',
          title: '你的分享有新的回复',
          body: content.slice(0, 40),
          refType: 'post',
          refId: postId,
        });
      }
    } else if (post.authorUid && post.authorUid !== ctx.uid) {
      await msg.push({
        toUid: post.authorUid,
        type: 'comment',
        title: '你的分享收到新评论',
        body: content.slice(0, 40),
        refType: 'post',
        refId: postId,
      });
    }
    if (isExpiry && post.authorUid && post.authorUid !== ctx.uid) {
      await msg.push({
        toUid: post.authorUid,
        type: 'expiry',
        title: '有同学说这条分享可能已过期',
        body: content.slice(0, 40),
        refType: 'post',
        refId: postId,
      });
    }
  }

  return ok({ commentId, floor, status, parentId: parentId || '', replyToFloor, isMine: true });
}, { write: true });
