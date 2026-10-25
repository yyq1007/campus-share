/** 限流（9.1 / 8.13） */
const { coll, _, COL, db } = require('./db');

/**
 * 固定窗口计数
 * @returns {Promise<{allowed:boolean, count:number, limit:number}>}
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
    try {
      await c.add({ data: { _id: id, uid, action, windowStart: new Date(start), count: 1 } });
    } catch (err) {
      // 并发下唯一键冲突：按已存在处理
      try {
        await c.doc(id).update({ data: { count: _.inc(1) } });
      } catch (e2) { /* ignore */ }
    }
    return { allowed: limit >= 1, count: 1, limit };
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
