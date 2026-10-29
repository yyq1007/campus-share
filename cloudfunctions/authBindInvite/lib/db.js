/** 数据库与通用工具 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const COL = {
  users: 'users',
  posts: 'posts',
  comments: 'comments',
  interactions: 'interactions',
  reports: 'reports',
  qaLogs: 'qaLogs',
  reviewQueue: 'reviewQueue',
  vectors: 'vectors',
  invites: 'invites',
  inviteCodes: 'inviteCodes',
  messages: 'messages',
  mediaAssets: 'mediaAssets',
  auditLogs: 'auditLogs',
  rateLimits: 'rateLimits',
  configs: 'configs',
  qrcodes: 'qrcodes',
  sensitiveWords: 'sensitiveWords',
};

function coll(name) {
  return db.collection(name);
}

const BASE32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomBase32(len) {
  let s = '';
  for (let i = 0; i < len; i += 1) s += BASE32[Math.floor(Math.random() * BASE32.length)];
  return s;
}

function shortId() {
  return randomBase32(6);
}

function charLen(str) {
  return Array.from(String(str || '')).length;
}

function normalizeText(str) {
  return String(str || '')
    .replace(/[\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

function excerpt(text, len = 60) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const arr = Array.from(t);
  return arr.length > len ? `${arr.slice(0, len).join('')}…` : t;
}

function linkHost(url) {
  const m = String(url || '').match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1] : '';
}

function isValidLink(url) {
  const s = String(url || '').trim();
  if (!s) return true;
  if (s.length > 200) return false;
  if (/\s/.test(s)) return false;
  if (!/^https?:\/\//i.test(s)) return false;
  if (/^(javascript|data|vbscript):/i.test(s)) return false;
  return true;
}

function ms(date) {
  if (!date) return 0;
  if (date instanceof Date) return date.getTime();
  if (typeof date === 'number') return date;
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function dayKey(d) {
  const dt = d ? new Date(d) : new Date();
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
}

/** 分页游标编解码（9.4） */
function encodeCursor(obj) {
  if (!obj) return null;
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function decodeCursor(str) {
  if (!str) return null;
  try {
    return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * 批量更新（分批执行，绕开单次 100 条上限）
 *
 * ⚠️ 云开发里 where().update() 单次最多影响约 100 条。
 * 直接调用时，超出部分不会被更新 —— 表现为「封禁了但老帖子还公开可见」。
 *
 * 做法（不依赖「更新字段出现在 where 条件里」这种脆弱前提）：
 *   1. 按 where 扫出 _id（分页，每页 scanLimit 条）
 *   2. 每 100 个 id 一组，用 where({_id: _.in(ids)}) 执行 update
 *   3. 翻页直到扫完或达到 maxRounds
 *
 * @param {string} colName 集合名
 * @param {object} where 查询条件
 * @param {object} data 更新字段
 * @param {object} [opts] { batchSize=100, scanLimit=500, maxRounds=40 }
 * @returns {Promise<number>} 实际更新条数
 */
async function batchUpdate(colName, where, data, opts = {}) {
  const batchSize = opts.batchSize || 100;
  const scanLimit = opts.scanLimit || 500;
  const maxRounds = opts.maxRounds || 40;
  let total = 0;
  let scanned = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await coll(colName)
      .where(where)
      .field({ _id: true })
      .skip(scanned)
      .limit(scanLimit)
      .get();
    const ids = (res.data || []).map((r) => r._id);
    if (!ids.length) break;
    scanned += ids.length;

    for (let i = 0; i < ids.length; i += batchSize) {
      const chunk = ids.slice(i, i + batchSize);
      // eslint-disable-next-line no-await-in-loop
      const r = await coll(colName).where({ _id: _.in(chunk) }).update({ data });
      total += (r && r.stats && r.stats.updated) || 0;
    }

    if (ids.length < scanLimit) break; // 扫完了
  }

  if (scanned >= scanLimit * maxRounds) {
    console.warn('[batchUpdate] 达到最大扫描轮次，可能仍有未处理数据:', colName, JSON.stringify(where));
  }
  return total;
}

module.exports = {
  cloud,
  db,
  _,
  $,
  COL,
  coll,
  shortId,
  randomBase32,
  charLen,
  normalizeText,
  excerpt,
  linkHost,
  isValidLink,
  ms,
  dayKey,
  encodeCursor,
  decodeCursor,
  batchUpdate,
};
