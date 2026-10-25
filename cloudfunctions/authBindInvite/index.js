/**
 * authBindInvite（9.3）
 * 数据模型：invites 集合一码多人用（code / disabled / maxUses / usedCount / lastUsedAt）
 * 归一化：库内统一大写存储，输入侧 toUpperCase 后精确匹配（用户输 gxnu2026 → GXNU2026）
 * 并发安全：乐观锁 update where usedCount < maxUses + $inc，只有未超额的请求能成功
 */
const { coll, COL, db, _ } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { resolveCtx } = require('./lib/auth');
const { mintUserCode, ensureUserCode } = require('./lib/invite');

// 6-16 位大写字母或数字（站点码如 GXNU2026 为 7 位、CAMPUS2026 为 10 位；手输/印刷码放宽到全字母数字）
const CODE_RE = /^[A-Z0-9]{6,16}$/;

exports.main = async (event) => {
  try {
    const r = await resolveCtx(event, { write: true });
    // 未注册也允许（首次进入就是未注册态）
    let uid = '';
    if (r.ctx) uid = r.ctx.uid;
    else if (r.error && r.error.code !== 40101) return r.error;

    if (!uid) {
      // 未注册用户：先建号再绑定
      const { cloud } = require('./lib/db');
      const wxContext = cloud.getWXContext();
      let openid = wxContext.OPENID || '';
      if (!openid && process.env.DEV_OPENID) openid = process.env.DEV_OPENID;
      if (!openid) return fail(40100);
      const exist = await coll(COL.users).where({ openid }).limit(1).get();
      if (exist.data && exist.data.length) uid = exist.data[0]._id;
      else {
        const { randomBase32 } = require('./lib/db');
        const add = await coll(COL.users).add({
          data: {
            openid,
            anonNo: randomBase32(4),
            role: 'user',
            status: 'active',
            inviteCode: '',
            credit: 100,
            avatar: null,
            stats: { posts: 0, favs: 0, cited: 0 },
            createdAt: db.serverDate(),
            lastActiveAt: db.serverDate(),
          },
        });
        uid = add._id;
      }
    }

    const code = String((event && event.code) || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return fail(40001, '邀请码格式不正确');

    // 已绑定过：幂等成功（并补齐个人邀请码）
    const me = await coll(COL.users).doc(uid).get();
    if (me.data && me.data.inviteCode) {
      const myCode = await ensureUserCode(me.data);
      return ok({ uid, stats: me.data.stats || { posts: 0, favs: 0, cited: 0 }, inviteCode: myCode, already: true });
    }

    // 一码多人用：先取码校验可用性，再用乐观锁扣减次数
    const inv = await coll(COL.invites).where({ code }).limit(1).get();
    if (!inv.data || !inv.data.length) return fail(40401, '邀请码无效');
    const inv0 = inv.data[0];
    if (inv0.disabled) return fail(40304, '邀请码已停用');
    const maxUses = Number(inv0.maxUses) || 0;
    if ((Number(inv0.usedCount) || 0) >= maxUses) return fail(40903, '邀请码已达使用上限');

    const upd = await coll(COL.invites)
      .where({ code, disabled: false, usedCount: _.lt(maxUses) })
      .update({ data: { usedCount: _.inc(1), lastUsedAt: db.serverDate() } });

    if (!upd.stats || upd.stats.updated !== 1) {
      // 并发临界点被他人抢先：再查一次给出准确原因
      const re = await coll(COL.invites).where({ code }).limit(1).get();
      const d = re.data && re.data[0];
      if (!d) return fail(40401, '邀请码无效');
      if (d.disabled) return fail(40304, '邀请码已停用');
      return fail(40903, '邀请码刚达到使用上限，请稍后再试');
    }

    // 绑定成功后同时发放个人邀请码（用于分享给同学）
    const myCode = await mintUserCode();
    await coll(COL.users).doc(uid).update({
      data: { inviteCode: code, myInviteCode: myCode, status: 'active', updatedAt: db.serverDate() },
    });

    const after = await coll(COL.users).doc(uid).get();
    return ok({ uid, inviteCode: myCode, stats: (after.data && after.data.stats) || { posts: 0, favs: 0, cited: 0 } });
  } catch (e) {
    console.error('[authBindInvite]', e && (e.stack || e));
    return fail(50001);
  }
};
