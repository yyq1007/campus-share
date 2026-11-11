/** 微信内容安全接口封装（15.1 L2/L3），接口不可用时的降级策略集中在此 */
const { cloud } = require('./db');

// 这类错误属于"能力未开通/额度/参数"，不是内容问题
const UNAVAILABLE = [-604101, 48001, 40013, 40125, 40164, 45009, 61010, 41004, -1];

function isUnavailable(err) {
  const code = err && (err.errCode !== undefined ? err.errCode : err.code);
  const msg = String((err && (err.errMsg || err.message)) || '');
  if (UNAVAILABLE.indexOf(Number(code)) > -1) return true;
  return /invalid appid|no permission|unauthorized|access token|api unauthorized|not support/i.test(msg);
}

function strictMode() {
  // 默认 strict：内容安全接口不可用时转人工复核（review），不直接放行。
  // 如需临时放宽（如尚未开通内容安全能力的开发阶段），
  // 在云函数环境变量里设 MODERATION_MODE=lenient 即可覆盖。
  return String(process.env.MODERATION_MODE || 'strict') === 'strict';
}

/** 文本检测：pass / review / risky */
async function msgSecCheck(content, openid) {
  const text = String(content || '').slice(0, 2500);
  if (!text) return { suggest: 'pass', degraded: false };
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      openid,
      scene: 3,
      content: text,
    });
    const r = (res && res.result) || {};
    const suggest = r.suggest || 'pass';
    return { suggest: suggest === 'pass' ? 'pass' : 'review', label: r.label || 0, degraded: false };
  } catch (e) {
    if (isUnavailable(e)) {
      console.warn('[msgSecCheck] unavailable, degrade:', e.errCode || e.errMsg);
      return { suggest: strictMode() ? 'review' : 'pass', degraded: true, errCode: e.errCode };
    }
    // 其他异常（含真实 openid 缺失、网络抖动）：不把用户提问/发帖一刀切拦掉，
    // strict 模式下保守置 review 走人工，lenient 模式下放行并标记 degraded。
    console.warn('[msgSecCheck] error, degrade:', e.errCode || e.errMsg);
    return { suggest: strictMode() ? 'review' : 'pass', degraded: true, errCode: e.errCode };
  }
}

/** 图片检测：pass / review / risky（buffer ≤1MB、≤750×1334） */
async function imgSecCheck(buffer, contentType) {
  if (!buffer) return { status: 'review', degraded: false };
  try {
    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType: contentType || 'image/jpeg', value: buffer },
    });
    const errCode = res && res.errCode;
    if (errCode === 0) return { status: 'pass', degraded: false };
    if (errCode === 87014) return { status: 'risky', degraded: false };
    return { status: 'review', degraded: false, errCode };
  } catch (e) {
    if (isUnavailable(e)) {
      console.warn('[imgSecCheck] unavailable, degrade:', e.errCode || e.errMsg);
      return { status: strictMode() ? 'review' : 'pass', degraded: true, errCode: e.errCode };
    }
    // 图片异常一律保守：人工复核（不做 lenient 放行，避免黄色图片进主流程）
    return { status: 'review', degraded: true, errCode: e.errCode };
  }
}

module.exports = { msgSecCheck, imgSecCheck, strictMode };
