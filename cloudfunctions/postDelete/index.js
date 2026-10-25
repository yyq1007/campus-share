/** postDelete（9.7）：软删 + 评论一并置删 + 媒体引用计数回收 */
const { coll, _, COL, db } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { incRef } = require('./lib/mediahelper');

exports.main = withAuth(async (event, ctx) => {
  const postId = String(event.postId || '');
  if (!postId) return fail(40001);

  let post;
  try {
    const r = await coll(COL.posts).doc(postId).get();
    post = r.data;
  } catch (e) {
    return fail(40401);
  }
  if (!post) return fail(40401);
  if (post.authorUid !== ctx.uid && ctx.role !== 'admin') return fail(40301);

  await coll(COL.posts).doc(postId).update({
    data: { status: 'deleted', deletedAt: db.serverDate(), updatedAt: db.serverDate() },
  });

  try {
    await coll(COL.comments).where({ postId }).update({ data: { status: 'deleted' } });
  } catch (e) { /* ignore */ }

  await Promise.all((post.media || []).map((m) => incRef(m.fileId, -1).catch(() => {})));

  if (post.authorUid) {
    await coll(COL.users).doc(post.authorUid).update({ data: { 'stats.posts': _.inc(-1) } }).catch(() => {});
  }

  return ok({ ok: true });
}, { write: true });
