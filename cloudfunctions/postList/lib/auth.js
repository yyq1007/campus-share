/** 鉴权中间层（9.1 / 16.3）：OPENID → users → ctx */
const { cloud, coll, COL, db } = require('./db');
const { fail } = require('./resp');

async function resolveCtx(event, opts) {
  const wxContext = cloud.getWXContext();
  let openid = wxContext.OPENID || '';
  // 仅用于云端自测（本地/控制台调用无 OPENID）；正式环境该变量为空
  if (!openid && process.env.DEV_OPENID) openid = process.env.DEV_OPENID;
  if (!openid) return { error: fail(40100) };

  const res = await coll(COL.users).where({ openid }).limit(1).get();
  if (!res.data.length) return { error: fail(40101) };
  const user = res.data[0];

  if (user.status === 'banned') return { error: fail(40302) };
  if (opts && opts.write && (user.status === 'deactivating' || user.status === 'deleted')) {
    return { error: fail(40302) };
  }
  if (opts && opts.write && user.status === 'muted') return { error: fail(40303) };

  return {
    ctx: {
      uid: user._id,
      role: user.role || 'user',
      status: user.status,
      credit: typeof user.credit === 'number' ? user.credit : 100,
      user,
      openid,
    },
  };
}

async function audit(actorUid, action, targetType, targetId, before, after, reason) {
  try {
    await coll(COL.auditLogs).add({
      data: {
        actorUid: actorUid || '',
        action,
        targetType: targetType || '',
        targetId: targetId || '',
        before: before || {},
        after: after || {},
        reason: reason || '',
        createdAt: db.serverDate(),
      },
    });
  } catch (e) {
    // 审计失败不阻断主流程
  }
}

/**
 * @param {(event:object, ctx:object)=>Promise<any>} handler
 * @param {{write?:boolean, admin?:boolean}} opts
 */
function withAuth(handler, opts = {}) {
  return async function main(event) {
    const r = await resolveCtx(event, opts);
    if (r.error) return r.error;
    if (opts.admin && r.ctx.role !== 'admin') {
      await audit(r.ctx.uid, 'forbidden', 'function', event && event.$action, { status: 'user' }, { status: 'denied' }, 'admin_only');
      return fail(40301);
    }
    try {
      return await handler(event || {}, r.ctx);
    } catch (e) {
      console.error('[handler-error]', e && (e.stack || e.message || e));
      return fail(50001);
    }
  };
}

module.exports = { resolveCtx, withAuth, audit };
