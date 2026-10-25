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
};
