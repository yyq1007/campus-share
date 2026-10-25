/**
 * reportCreate（9.11）
 * 唯一索引防重复（_id = reporterUid+target）→ 写 reports + reviewQueue
 * 同一目标被举报 ≥3 次 → 队列 priority 置 1（顶到最上）
 */
const { coll, _, COL, db, shortId } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth, audit } = require('./lib/auth');
const { getConfig } = require('./lib/config');
const rate = require('./lib/rate');

const TARGET_TYPES = ['post', 'comment', 'user'];
const REASON_CODES = ['spam', 'porn', 'ad', 'abuse', 'fake', 'privacy', 'other'];
const PRIORITY_TOP = 1;
const PRIORITY_REPORT = 9;
const MERGE_THRESHOLD = 3;

exports.main = withAuth(async (event, ctx) => {
  const targetType = String(event.targetType || '');
  const targetId = String(event.targetId || '').trim();
  const reasonCode = String(event.reasonCode || '');
  const reasonText = String(event.reasonText || '').trim().slice(0, 200);

  if (TARGET_TYPES.indexOf(targetType) === -1) return fail(40001, '举报对象不合法');
  if (!targetId) return fail(40001, '缺少举报对象');
  if (REASON_CODES.indexOf(reasonCode) === -1) return fail(40001, '请选择举报原因');
  if (reasonCode === 'other' && !reasonText) return fail(40001, '请补充说明');

  // 目标存在性校验
  if (targetType === 'post') {
    try {
      const r = await coll(COL.posts).doc(targetId).get();
      if (!r.data || r.data.status === 'deleted') return fail(40401);
    } catch (e) {
      return fail(40401);
    }
  } else if (targetType === 'comment') {
    try {
      const r = await coll(COL.comments).doc(targetId).get();
      if (!r.data) return fail(40401);
    } catch (e) {
      return fail(40401);
    }
  }

  // 频控 20 次/天
  const config = await getConfig();
  const limit = (config.limits && config.limits.reportPerDay) || 20;
  const rl = await rate.hit(ctx.uid, 'reportCreate', limit, 24 * 60 * 60 * 1000);
  if (!rl.allowed) return fail(42901, `今天最多举报 ${limit} 次`);

  // 防重复：同一人对同一目标只允许一次
  const rid = `${ctx.uid}_${targetType}_${targetId}`;
  try {
    const dup = await coll(COL.reports).doc(rid).get();
    if (dup && dup.data) return fail(40902, '你已经举报过了');
  } catch (e) { /* 不存在，继续 */ }

  const now = new Date();
  try {
    await coll(COL.reports).add({
      data: {
        _id: rid,
        reporterUid: ctx.uid,
        targetType,
        targetId,
        reasonCode,
        reasonText,
        status: 'pending',
        handledBy: '',
        handledAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (e) {
    return fail(40902, '你已经举报过了');
  }

  // 统计该目标被举报次数，决定队列优先级
  let reportCount = 1;
  try {
    const c = await coll(COL.reports).where({ targetType, targetId }).count();
    reportCount = c.total || 1;
  } catch (e) { /* ignore */ }

  const priority = reportCount >= MERGE_THRESHOLD ? PRIORITY_TOP : PRIORITY_REPORT;

  // 同一目标的举报合并进同一条队列记录，避免审核台刷屏
  // 注意：doc(id).get() 在文档不存在时是 reject，必须局部 try 兜住，否则整段队列逻辑被跳过
  const queueKey = `report_${targetType}_${targetId}`;
  let q = null;
  try {
    q = await coll(COL.reviewQueue).doc(queueKey).get();
  } catch (e) {
    q = null;
  }
  try {
    if (q && q.data && q.data.status === 'pending') {
      await coll(COL.reviewQueue).doc(queueKey).update({
        data: {
          reportCount: _.inc(1),
          priority,
          reason: `${reasonCode}${reasonText ? ` · ${reasonText}` : ''}`,
          updatedAt: db.serverDate(),
        },
      });
    } else if (q && q.data) {
      // 已处理过又再次被举报：重新入队
      await coll(COL.reviewQueue).doc(queueKey).update({
        data: {
          status: 'pending',
          reportCount: _.inc(1),
          priority,
          reason: `${reasonCode}${reasonText ? ` · ${reasonText}` : ''}`,
          handledBy: '',
          handledAt: null,
          updatedAt: db.serverDate(),
        },
      });
    } else {
      await coll(COL.reviewQueue).add({
        data: {
          _id: queueKey,
          targetType,
          targetId,
          source: 'report',
          aiLabel: '用户举报',
          reason: `${reasonCode}${reasonText ? ` · ${reasonText}` : ''}`,
          reportCount: 1,
          priority,
          status: 'pending',
          handledBy: '',
          handledAt: null,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
    }
  } catch (e) {
    // 队列写入失败不影响举报成功
    console.warn('[reportCreate] queue failed', e && e.message);
  }

  await audit(ctx.uid, 'report_create', targetType, targetId, { status: 'none' }, { status: 'pending', reasonCode }, `report:${shortId()}`);

  return ok({ reportId: rid, reportCount });
}, { write: true });
