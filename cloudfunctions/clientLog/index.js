/**
 * clientLog（9.24）
 * 只写云开发日志，不落业务库；按 uid 限流 10 次/分钟，超限静默丢弃
 * 任何异常都必须吞掉：上报失败不得影响用户体验
 */
const { cloud } = require('./lib/db');
const { ok } = require('./lib/resp');
const { peek, hit } = require('./lib/rate');

const LIMIT = 10;
const WINDOW = 60 * 1000; // 分钟窗口
const TYPE_OK = ['error', 'rejection', 'api'];

function cutoff(s, n) {
  return String(s || '').slice(0, n);
}

exports.main = async (event) => {
  try {
    let uid = '';
    try {
      const wc = cloud.getWXContext();
      uid = wc.OPENID || process.env.DEV_OPENID || '';
    } catch (e) { /* ignore */ }

    if (!uid) return ok({ ok: true, dropped: true });

    // 用 peek + 手动累加，避免再多一次写
    const used = await peek(uid, 'clientLog', WINDOW);
    if (used >= LIMIT) return ok({ ok: true, dropped: true });

    const type = TYPE_OK.indexOf(event && event.type) > -1 ? event.type : 'error';
    const message = cutoff(event && event.message, 500);
    const stack = cutoff(event && event.stack, 2000);
    const page = cutoff(event && event.page, 200);
    let extra = '';
    try {
      extra = JSON.stringify(event && event.extra ? event.extra : {}).slice(0, 1000);
    } catch (e) {
      extra = '';
    }

    // 计入限流窗口（用 rateLimits 集合，与业务共用，无额外集合）
    // 这里不因超限而拦截，只记录次数，超限后直接丢弃
    await hit(uid, 'clientLog', LIMIT + 1, WINDOW).catch(() => {});

    console.log(`[clientLog] type=${type} page=${page} msg=${message} stack=${stack} extra=${extra}`);
    return ok({ ok: true });
  } catch (e) {
    return ok({ ok: false });
  }
};
