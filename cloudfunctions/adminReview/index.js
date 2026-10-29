/**
 * adminReview（9.17）
 * 条件更新 reviewQueue.status='pending' 防双审 → 改内容状态 → 通知/计分 → 审计
 * approve：补 publishedAt / searchTokens / hotScore 并触发向量化
 * reject ：给作者发 review_result 消息（附原因）；评论驳回需回退 commentCount
 * banUser：封禁作者并批量隐藏其内容
 */
const { coll, _, COL, db, excerpt, batchUpdate } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth, audit } = require('./lib/auth');
const { tokenize } = require('./lib/tokenize');
const { hotScore } = require('./lib/hot');
const msg = require('./lib/msg');

const ACTIONS = ['approve', 'reject', 'hide', 'ignore', 'banUser'];
const QUEUE_STATUS = {
  approve: 'approved',
  reject: 'rejected',
  hide: 'rejected',
  ignore: 'ignored',
  banUser: 'rejected',
};

async function notifyAuthor(toUid, postId, title, body, type) {
  if (!toUid) return;
  try {
    await msg.push({ toUid, type: type || 'review_result', title, body, refType: 'post', refId: postId });
  } catch (e) { /* ignore */ }
}

exports.main = withAuth(async (event, ctx) => {
  const queueId = String(event.queueId || '').trim();
  const action = String(event.action || '');
  const reason = String(event.reason || '').trim().slice(0, 100);

  if (!queueId) return fail(40001, '缺少队列 ID');
  if (ACTIONS.indexOf(action) === -1) return fail(40001, '不支持的处理动作');
  if ((action === 'reject' || action === 'hide' || action === 'banUser') && !reason) {
    return fail(40001, '请填写处理理由');
  }

  let q;
  try {
    const r = await coll(COL.reviewQueue).doc(queueId).get();
    q = r.data;
  } catch (e) {
    return fail(40401, '这条内容已被其他人处理');
  }
  if (!q) return fail(40401);
  if (q.status !== 'pending') return fail(40904);

  // 条件更新：只有仍是 pending 才能占到，防并发双审
  const now = new Date();
  try {
    const up = await coll(COL.reviewQueue)
      .where({ _id: queueId, status: 'pending' })
      .update({
        data: {
          status: QUEUE_STATUS[action],
          reviewerUid: ctx.uid,
          handledBy: ctx.uid,
          reviewedAt: now,
          handledAt: now,
          reviewNote: reason || (action === 'approve' ? '审核通过' : action === 'ignore' ? '忽略举报' : ''),
          updatedAt: db.serverDate(),
        },
      });
    if (!up.stats || !up.stats.updated) return fail(40904);
  } catch (e) {
    return fail(40904);
  }

  const isComment = q.targetType === 'comment';
  let targetStatus = '';

  try {
    if (isComment) {
      let c = null;
      try {
        const r = await coll(COL.comments).doc(q.targetId).get();
        c = r.data;
      } catch (e) { c = null; }
      if (c) {
        if (action === 'approve') {
          targetStatus = 'published';
          await coll(COL.comments).doc(q.targetId).update({
            data: { status: 'published', 'risk.level': 'pass', updatedAt: db.serverDate() },
          });
        } else if (action === 'reject' || action === 'hide') {
          targetStatus = action === 'reject' ? 'rejected' : 'hidden';
          await coll(COL.comments).doc(q.targetId).update({
            data: { status: targetStatus, hideReason: reason, updatedAt: db.serverDate() },
          });
          // 评论计数在创建时就已 +1，驳回/隐藏需回退
          try {
            const p = await coll(COL.posts).doc(c.postId).get();
            const cur = (p.data && p.data.stats && p.data.stats.commentCount) || 0;
            await coll(COL.posts).doc(c.postId).update({
              data: { 'stats.commentCount': Math.max(0, cur - 1) },
            });
          } catch (e) { /* ignore */ }
          await notifyAuthor(c.authorUid, c.postId, '你的评论未通过审核',
            reason ? `原因：${reason}` : '请修改后重新发布', 'review_result');
        } else if (action === 'banUser') {
          targetStatus = 'hidden';
          await coll(COL.comments).doc(q.targetId).update({
            data: { status: 'hidden', hideReason: reason, updatedAt: db.serverDate() },
          });
        } else {
          targetStatus = c.status;
        }
      } else {
        targetStatus = 'deleted';
      }
    } else {
      let p = null;
      try {
        const r = await coll(COL.posts).doc(q.targetId).get();
        p = r.data;
      } catch (e) { p = null; }

      if (!p) {
        targetStatus = 'deleted';
      } else if (action === 'approve') {
        targetStatus = 'published';
        await coll(COL.posts).doc(q.targetId).update({
          data: {
            status: 'published',
            publishedAt: p.publishedAt || now,
            'risk.level': 'pass',
            rejectReason: '',
            hideReason: '',
            hotScore: hotScore(p.stats || {}, p.publishedAt || now, now.getTime()),
            searchTokens: tokenize(`${p.title || ''} ${p.content || ''} ${Object.values(p.fields || {}).join(' ')}`),
            updatedAt: db.serverDate(),
          },
        });
        // 通过后补结构化与向量（必须 await，否则容器冻结会丢调用）
        const { cloud } = require('./lib/db');
        await Promise.race([
          cloud.callFunction({ name: 'aiStructure', data: { postId: q.targetId } }),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]).catch(() => {});
        await notifyAuthor(p.authorUid, q.targetId, '你的分享已通过审核',
          `《${excerpt(p.title || p.content, 20)}》已公开，同学们可以看到啦`, 'review_result');
      } else if (action === 'reject') {
        targetStatus = 'rejected';
        await coll(COL.posts).doc(q.targetId).update({
          data: { status: 'rejected', rejectReason: reason, updatedAt: db.serverDate() },
        });
        await notifyAuthor(p.authorUid, q.targetId, '你的分享未通过审核',
          reason ? `原因：${reason}。可以修改后重新提交。` : '可以修改后重新提交。', 'review_result');
      } else if (action === 'hide') {
        targetStatus = 'hidden';
        await coll(COL.posts).doc(q.targetId).update({
          data: { status: 'hidden', hideReason: reason, updatedAt: db.serverDate() },
        });
        await notifyAuthor(p.authorUid, q.targetId, '你的分享已被隐藏',
          reason ? `原因：${reason}` : '', 'review_result');
      } else if (action === 'banUser') {
        targetStatus = 'hidden';
        await coll(COL.posts).doc(q.targetId).update({
          data: { status: 'hidden', hideReason: reason, updatedAt: db.serverDate() },
        });
      } else {
        // ignore：仅结束队列；若目标仍是非公开状态（举报驳回），保持原样
        targetStatus = p.status;
      }
    }

    // 封禁作者：置 banned + 批量隐藏其已发布内容
    if (action === 'banUser') {
      let authorUid = '';
      try {
        if (isComment) {
          const r = await coll(COL.comments).doc(q.targetId).get();
          authorUid = (r.data && r.data.authorUid) || '';
        } else {
          const r = await coll(COL.posts).doc(q.targetId).get();
          authorUid = (r.data && r.data.authorUid) || '';
        }
      } catch (e) { /* ignore */ }
      if (authorUid) {
        await coll(COL.users).doc(authorUid).update({
          data: { status: 'banned', bannedAt: now, banReason: reason, updatedAt: db.serverDate() },
        });
        try {
          // ⚠️ 单次 where().update() 上限约 100 条，用户发过 >100 篇时
          // 剩下的帖子仍公开可见 → 封禁形同虚设。改用分批更新。
          const hidden = await batchUpdate(COL.posts, { authorUid, status: 'published' }, {
            status: 'hidden', hideReason: `作者封禁：${reason}`, updatedAt: db.serverDate(),
          });
          if (hidden) console.log('[adminReview] 封禁作者，已隐藏帖子', hidden);
        } catch (e) { /* 批量隐藏失败不阻断 */ }
        await audit(ctx.uid, 'ban', 'user', authorUid, { status: 'active' }, { status: 'banned' }, reason);
      }
    }
  } catch (e) {
    console.error('[adminReview] target update failed', e && (e.message || e));
    // 队列状态已改，返回成功但标注部分失败，避免审核台反复重试
    return ok({ ok: false, targetStatus: '', warning: '内容状态更新失败，请稍后人工确认' });
  }

  await audit(ctx.uid, action, q.targetType, q.targetId, { status: 'pending' }, { status: targetStatus }, reason);

  return ok({ ok: true, targetStatus });
}, { admin: true });
