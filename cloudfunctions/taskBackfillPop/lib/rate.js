/** 限流（9.1 / 8.13） */
const { coll, _, COL, db } = require('./db');

/**
 * 固定窗口计数
 *
 * ⚠️ 限流必须 fail-closed：计数失败时若直接放行，
 * 请求既没被计数也没被拦下 → 限流形同虚设（可被并发绕过）。
 * 所以这里的约定是：
 *   - 正常路径：原子自增 → 读回真实 count → count <= limit 才放行
 *   - 异常路径：尽力把计数补上（补不上则按已超限处理）→ 默认拒绝
 *
 * @returns {Promise<{allowed:boolean, count:number, limit:number, degraded?:boolean}>}
 */
async function hit(uid, action, limit, windowMs) {
  const now = Date.now();
  const start = now - (now % windowMs);
  const id = `${uid}:${action}:${start}`;
  const c = coll(COL.rateLimits);
  try {
    const res = await c.doc(id).update({ data: { count: _.inc(1) } });
    if (!res.stats || !res.stats.updated) throw new Error('MISS');
    const doc = await c.doc(id).get();
    const count = (doc.data && doc.data.count) || 1;
    return { allowed: count <= limit, count, limit };
  } catch (e) {
    // 到这里说明「文档还不存在」或「数据库异常」，两条路都要自己把计数写回去
    let counted = false;
    try {
      await c.add({ data: { _id: id, uid, action, windowStart: new Date(start), count: 1 } });
      counted = true;
    } catch (err) {
      // 并发下唯一键冲突：文档已存在 → 改成自增
      try {
        const r2 = await c.doc(id).update({ data: { count: _.inc(1) } });
        counted = !!(r2 && r2.stats && r2.stats.updated);
      } catch (e2) { /* 计数补不上 → 走下面的 fail-closed */ }
    }

    if (!counted) {
      // 计数完全没写进去：无法判断是否超限 → 拒绝（fail-closed）
      console.error('[rate.hit] 计数失败，已拒绝本次请求:', uid, action, e && (e.message || e));
      return { allowed: false, count: limit + 1, limit, degraded: true };
    }

    // 计数补上了：读回真实值再判断（并发自增后可能已超限）
    let count = 1;
    try {
      const doc = await c.doc(id).get();
      count = (doc.data && doc.data.count) || 1;
    } catch (e3) {
      // 读不回来但计数已写入：保守按超限处理
      console.error('[rate.hit] 读取计数失败，已拒绝本次请求:', uid, action, e3 && (e3.message || e3));
      return { allowed: false, count: limit + 1, limit, degraded: true };
    }
    return { allowed: count <= limit, count, limit };
  }
}

/** 读取当前窗口已用次数（不计数） */
async function peek(uid, action, windowMs) {
  const now = Date.now();
  const start = now - (now % windowMs);
  const id = `${uid}:${action}:${start}`;
  try {
    const doc = await coll(COL.rateLimits).doc(id).get();
    return (doc.data && doc.data.count) || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = { hit, peek };
