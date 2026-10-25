/**
 * authDelete（9.23）
 * 二次校验确认文案（防误触）→ 进入 7 天冷静期 → 发消息告知
 * 冷静期内可再次调用 { revoke: true } 撤销；到期由 taskCleanup 匿名化
 */
const { coll, COL, db } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth, audit } = require('./lib/auth');
const msg = require('./lib/msg');

const COOLING_DAYS = 7;
const CONFIRM_TEXT = '注销';

exports.main = withAuth(async (event, ctx) => {
  // 撤销：冷静期内随时可撤回
  if (event && event.revoke === true) {
    if (ctx.status !== 'deactivating') return ok({ ok: true, revoked: false, status: ctx.status });
    await coll(COL.users).doc(ctx.uid).update({
      data: { status: 'active', deleteAt: null, deletedAt: null, updatedAt: db.serverDate() },
    });
    await audit(ctx.uid, 'unban', 'user', ctx.uid, { status: 'deactivating' }, { status: 'active' }, 'revoke_delete');
    return ok({ ok: true, revoked: true, status: 'active' });
  }

  const confirm = String((event && event.confirm) || '').trim();
  const reason = String((event && event.reason) || '').trim().slice(0, 100);
  if (confirm !== CONFIRM_TEXT) return fail(40001, '请按提示输入「注销」两个字');

  if (ctx.status === 'banned') return fail(40302);
  if (ctx.status === 'deactivating') {
    // 幂等：重复提交返回同一个到期时间
    const exist = ctx.user.deleteAt ? new Date(ctx.user.deleteAt).getTime() : Date.now() + COOLING_DAYS * 86400000;
    return ok({ ok: true, deleteAt: exist, already: true });
  }

  const deleteAt = new Date(Date.now() + COOLING_DAYS * 86400000);
  await coll(COL.users).doc(ctx.uid).update({
    data: {
      status: 'deactivating',
      deletedAt: db.serverDate(),
      deleteAt,
      deleteReason: reason,
      updatedAt: db.serverDate(),
    },
  });

  await audit(ctx.uid, 'delete', 'user', ctx.uid, { status: ctx.status }, { status: 'deactivating' }, reason || 'user_request');

  // 告知冷静期与撤销方式
  try {
    await msg.push({
      toUid: ctx.uid,
      type: 'system',
      title: '账号注销申请已提交',
      body: `${COOLING_DAYS} 天后将完成注销。期间重新进入小程序可撤销申请。`,
      refType: 'post',
      refId: '',
    });
  } catch (e) { /* 不发也不阻断 */ }

  return ok({ ok: true, deleteAt: deleteAt.getTime() });
}, { write: false });
