/** 配置读取（configs/global），60s 进程内缓存 */
const { coll, COL } = require('./db');

const DEFAULTS = {
  boards: {
    life: { label: '生活', fields: ['shop', 'price', 'location'] },
    study: { label: '学习', fields: ['course', 'teacher', 'material'] },
    food: { label: '美食', fields: ['shop', 'price', 'location'] },
  },
  limits: {
    postPer10min: 3,
    commentPer10min: 10,
    askPerDay: 10,
    reportPerDay: 20,
    qrcodePerDay: 5,
    maxImages: 6,
    maxImageMB: 1,
    maxVideoMB: 30,
    videoSeconds: 60,
    avatarPerHour: 3,
    loginPer10min: 5,
  },
  hot: { like: 3, fav: 4, comment: 5, cite: 6, gravity: 1.5, expireDays: 90 },
  ai: { model: 'local-rag', topK: 5, minScore: 0.18, dailyBudget: 500, enabled: false },
  lexicon: { version: 'v1', rejectEnabled: true, strikeCooldownMin: 10, strikeThreshold: 3 },
  flags: { allowVideo: true, allowAsk: true, maintenance: false },
};

let cache = null;
let cacheAt = 0;
const TTL = 60 * 1000;

function merge(base, extra) {
  const out = Object.assign({}, base);
  Object.keys(extra || {}).forEach((k) => {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k]) {
      out[k] = Object.assign({}, base[k], extra[k]);
    } else if (extra[k] !== undefined) {
      out[k] = extra[k];
    }
  });
  return out;
}

async function getConfig(force) {
  const now = Date.now();
  if (!force && cache && now - cacheAt < TTL) return cache;
  let doc = null;
  try {
    const res = await coll(COL.configs).doc('global').get();
    doc = res.data;
  } catch (e) {
    doc = null;
  }
  cache = merge(DEFAULTS, doc || {});
  cacheAt = now;
  return cache;
}

module.exports = { getConfig, DEFAULTS };
