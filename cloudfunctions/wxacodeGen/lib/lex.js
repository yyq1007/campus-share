/**
 * L1 本地敏感词过滤（15.3 / 15.4）
 * - 归一并保持长度不变（NFKC 常见范围 / 全角→半角 / 大小写 / 零宽字符）
 * - AC 自动机多模式匹配
 * - reject 命中 → 直接驳回，只回传位置区间，不回传词条
 * - 无词库时使用内置兜底词条
 */
const { coll, COL } = require('./db');

const FALLBACK_TERMS = [
  { term: '收黑钱', level: 'reject', category: 'accuse' },
  { term: '地沟油', level: 'reject', category: 'accuse' },
  { term: '吃回扣', level: 'reject', category: 'accuse' },
  { term: '走后门', level: 'review', category: 'accuse' },
  { term: '内定', level: 'review', category: 'accuse' },
  { term: '黑幕', level: 'review', category: 'accuse' },
  { term: '骗钱', level: 'reject', category: 'accuse' },
  { term: '贪污', level: 'reject', category: 'accuse' },
  { term: '傻逼', level: 'reject', category: 'abuse' },
  { term: '沙比', level: 'reject', category: 'abuse' },
  { term: '煞笔', level: 'reject', category: 'abuse' },
  { term: '脑残', level: 'reject', category: 'abuse' },
  { term: '智障', level: 'reject', category: 'abuse' },
  { term: '贱人', level: 'reject', category: 'abuse' },
  { term: '去死', level: 'reject', category: 'abuse' },
  { term: '狗东西', level: 'reject', category: 'abuse' },
  { term: '代购', level: 'review', category: 'ad' },
  { term: '刷单', level: 'reject', category: 'ad' },
  { term: '加微信', level: 'review', category: 'contact' },
  { term: '私聊我', level: 'review', category: 'ad' },
  { term: '一手货源', level: 'reject', category: 'ad' },
  { term: '招代理', level: 'reject', category: 'ad' },
  { term: '兼职日结', level: 'reject', category: 'ad' },
  { term: '扫码进群', level: 'review', category: 'ad' },
  { term: '淘口令', level: 'review', category: 'ad' },
  { term: '约炮', level: 'reject', category: 'porn' },
  { term: '裸聊', level: 'reject', category: 'porn' },
  { term: '赌博', level: 'reject', category: 'other' },
  { term: '博彩', level: 'reject', category: 'other' },
  { term: '枪支', level: 'reject', category: 'violence' },
  { term: '毒品', level: 'reject', category: 'violence' },
];

const REGEX_RULES = [
  { re: /(?:\+?86[-\s]?)?1[3-9]\d{9}/g, level: 'review', category: 'contact' },
  { re: /(?:qq|扣扣)\s*[:：]?\s*\d{5,11}/gi, level: 'review', category: 'contact' },
  { re: /(?:加|➕|\+)\s*(?:v|V|微|威信|微信|wx|WX)\s*[:：]?\s*[a-zA-Z][-_a-zA-Z0-9]{5,19}/g, level: 'review', category: 'contact' },
];

function normalizeChar(ch) {
  const code = ch.charCodeAt(0);
  // 零宽 / BOM
  if ((code >= 0x200b && code <= 0x200f) || code === 0xfeff) return ' ';
  // 全角 ASCII
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0).toLowerCase();
  if (code === 0x3000) return ' ';
  return ch.toLowerCase();
}

function normalize(str) {
  const chars = Array.from(String(str || ''));
  return chars.map(normalizeChar);
}

/** AC 自动机 */
function buildMachine(terms) {
  const root = { next: Object.create(null), fail: null, out: [] };
  terms.forEach((t) => {
    const chars = normalize(t.term);
    if (!chars.length) return;
    let node = root;
    chars.forEach((c) => {
      if (!node.next[c]) node.next[c] = { next: Object.create(null), fail: null, out: [] };
      node = node.next[c];
    });
    node.out.push({ level: t.level, category: t.category, len: chars.length });
  });

  // BFS 构建失败指针
  const queue = [];
  Object.keys(root.next).forEach((k) => {
    root.next[k].fail = root;
    queue.push(root.next[k]);
  });
  while (queue.length) {
    const node = queue.shift();
    Object.keys(node.next).forEach((k) => {
      const child = node.next[k];
      let f = node.fail;
      while (f && !f.next[k]) f = f.fail;
      child.fail = f && f.next[k] ? f.next[k] : root;
      child.out = child.out.concat(child.fail.out);
      queue.push(child);
    });
  }
  return root;
}

let cached = null;
let cachedAt = 0;
const TTL = 5 * 60 * 1000;

async function loadTerms() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL) return cached;
  let terms = [];
  try {
    const res = await coll(COL.sensitiveWords).where({ enabled: true }).limit(1000).get();
    terms = (res.data || [])
      .filter((d) => d.term && d.type !== 'regex' && d.level !== 'allow')
      .map((d) => ({ term: d.term, level: d.level || 'review', category: d.category || 'other' }));
  } catch (e) {
    terms = [];
  }
  if (!terms.length) terms = FALLBACK_TERMS;
  cached = { machine: buildMachine(terms), size: terms.length };
  cachedAt = now;
  return cached;
}

/**
 * @returns {Promise<{reject:boolean, review:boolean, ranges:number[][], categories:string[]}>}
 */
async function check(text, options = {}) {
  const { machine } = await loadTerms();
  const chars = normalize(text);
  const ranges = [];
  const categories = new Set();
  let reject = false;
  let review = false;

  let node = machine;
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    while (node && !node.next[c]) node = node.fail;
    node = node && node.next[c] ? node.next[c] : machine;
    if (node.out && node.out.length) {
      node.out.forEach((o) => {
        const start = i - o.len + 1;
        if (start < 0) return;
        ranges.push([start, i + 1]);
        categories.add(o.category);
        if (o.level === 'reject') reject = true;
        else review = true;
      });
    }
  }

  if (options.regex !== false) {
    const raw = String(text || '');
    REGEX_RULES.forEach((rule) => {
      rule.re.lastIndex = 0;
      let m = rule.re.exec(raw);
      while (m) {
        const start = Array.from(raw.slice(0, m.index)).length;
        const len = Array.from(m[0]).length;
        ranges.push([start, start + len]);
        categories.add(rule.category);
        if (rule.level === 'reject') reject = true;
        else review = true;
        m = rule.re.exec(raw);
      }
    });
  }

  // 合并重叠区间
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  });

  return { reject, review, ranges: merged, categories: Array.from(categories) };
}

module.exports = { check, loadTerms, FALLBACK_TERMS };
