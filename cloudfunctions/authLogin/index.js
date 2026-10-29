/**
 * authLogin（9.2）
 * 入参 {}，身份只认 OPENID；不存在则建号，needInvite=true
 */
const { cloud, coll, COL, db, randomBase32, ms } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { getConfig } = require('./lib/config');
const msg = require('./lib/msg');
const { ensureUserCode } = require('./lib/invite');
const rate = require('./lib/rate');

/**
 * 是否允许当前 openid 触发「首个登录者自动成为管理员」。
 *
 * 默认行为（未设环境变量）：允许——保持作者原有逻辑。
 * 正式上线建议在云函数环境变量里配置：
 *   BOOTSTRAP_ADMIN=off            → 完全关闭自动提权（需手动指定管理员）
 *   BOOTSTRAP_ADMIN=<你的openid>  → 只有该 openid 能成为管理员
 * 取值时忽略大小写与首尾空格；"off"/"0"/"false"/"none" 均视为关闭。
 */
function bootstrapAllowed(openid) {
  const raw = String(process.env.BOOTSTRAP_ADMIN || '').trim();
  if (!raw) return true;
  const v = raw.toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'none') return false;
  return raw === String(openid || '').trim();
}

exports.main = async () => {
  try {
    const wxContext = cloud.getWXContext();
    let openid = wxContext.OPENID || '';
    if (!openid && process.env.DEV_OPENID) openid = process.env.DEV_OPENID;
    if (!openid) return fail(40100);

    const config = await getConfig();

    // 冷启动频控：登录接口是匿名可调的入口（建号前没有 uid），
    // 按 openid 限流，防刷建号 / 撞 bootstrap admin 位。
    // 正常用户每次冷启动只登录 1 次，10 分钟 5 次足够宽松。
    try {
      const limits = config.limits || {};
      const rl = await rate.hit(openid, 'authLogin', limits.loginPer10min || 5, 10 * 60 * 1000);
      if (!rl.allowed) return fail(42901);
    } catch (e) {
      // 限流模块异常不阻断登录（可用性优先于防刷）
      console.warn('[authLogin] rate limit check failed:', (e && e.message) || e);
    }

    const res = await coll(COL.users).where({ openid }).limit(1).get();

    if (!res.data.length) {
      const doc = {
        openid,
        anonNo: randomBase32(4),
        role: 'user',
        status: 'active',
        inviteCode: '',
        credit: 100,
        avatar: null,
        stats: { posts: 0, favs: 0, cited: 0 },
        privacyVersion: 'v1',
        privacyAgreedAt: db.serverDate(),
        createdAt: db.serverDate(),
        lastActiveAt: db.serverDate(),
      };
      const add = await coll(COL.users).add({ data: doc });

      // 引导：系统里还没有管理员时，第一个登录（含首登建号）的账号自动成为管理员
      // MVP 阶段没有后台发号入口，否则审核台永远打不开；一旦有 admin 就不再触发
      // ⚠️ 安全开关：BOOTSTRAP_ADMIN=off 可关闭自动提权；
      //    BOOTSTRAP_ADMIN=<openid> 可限定只有该 openid 能成为管理员。
      let newRole = 'user';
      let newPending = 0;
      try {
        if (bootstrapAllowed(openid)) {
          const admins = await coll(COL.users).where({ role: 'admin' }).count();
          if (!admins.total) {
            await coll(COL.users).doc(add._id).update({ data: { role: 'admin', updatedAt: db.serverDate() } });
            newRole = 'admin';
            console.log('[authLogin] bootstrap admin (new user) ->', add._id);
          }
        }
      } catch (e) { /* 计数失败不影响登录 */ }
      if (newRole === 'admin') {
        try {
          const q = await coll(COL.reviewQueue).where({ status: 'pending' }).count();
          newPending = q.total || 0;
        } catch (e) { newPending = 0; }
      }

      return ok({
        uid: add._id,
        role: newRole,
        status: 'active',
        needInvite: true,
        inviteBound: false,
        stats: doc.stats,
        unread: 0,
        pendingCount: newPending,
        avatar: null,
        canRevoke: false,
        config,
      });
    }

    const user = res.data[0];
    if (user.status === 'banned') return fail(40302);

    // 引导：系统里还没有管理员时，第一个登录的账号自动成为管理员
    // （MVP 阶段没有后台发号入口，避免审核台永远打不开；有管理员后不再触发）
    // ⚠️ 安全开关：见 bootstrapAllowed() 说明
    let role = user.role || 'user';
    if (role !== 'admin') {
      try {
        if (bootstrapAllowed(openid)) {
          const admins = await coll(COL.users).where({ role: 'admin' }).count();
          if (!admins.total) {
            await coll(COL.users).doc(user._id).update({ data: { role: 'admin', updatedAt: db.serverDate() } });
            role = 'admin';
            console.log('[authLogin] bootstrap admin ->', user._id);
          }
        }
      } catch (e) { /* 计数失败不影响登录 */ }
    }

    // 7 天节流的活跃时间更新，避免写放大
    const last = ms(user.lastActiveAt);
    if (!last || Date.now() - last > 7 * 24 * 3600 * 1000) {
      coll(COL.users).doc(user._id).update({ data: { lastActiveAt: db.serverDate() } }).catch(() => {});
    }

    const unread = await msg.unreadCount(user._id);
    let pendingCount = 0;
    if (role === 'admin') {
      try {
        const q = await coll(COL.reviewQueue).where({ status: 'pending' }).count();
        pendingCount = q.total || 0;
      } catch (e) {
        pendingCount = 0;
      }
    }

    return ok({
      uid: user._id,
      role,
      status: user.status,
      needInvite: !user.inviteCode,
      inviteBound: !!user.inviteCode,
      stats: user.stats || { posts: 0, favs: 0, cited: 0 },
      unread,
      pendingCount,
      avatar: user.avatar || null,
      inviteCode: await ensureUserCode(user),
      canRevoke: user.status === 'deactivating',
      config,
    });
  } catch (e) {
    console.error('[authLogin]', e && (e.stack || e));
    return fail(50001);
  }
};
