/** 分词：中文 2-gram + 英文/数字整词，用于 searchTokens 与检索 */
const STOP = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '也', '很', '都']);

function tokenize(text, max = 200) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ');
  const out = new Set();
  s.split(/\s+/).filter(Boolean).forEach((seg) => {
    if (/^[a-z0-9]+$/.test(seg)) {
      if (seg.length >= 2) out.add(seg);
      return;
    }
    const chars = Array.from(seg).filter((c) => !STOP.has(c));
    for (let i = 0; i < chars.length; i += 1) {
      if (i + 1 < chars.length) out.add(chars[i] + chars[i + 1]);
      else if (chars.length === 1) out.add(chars[i]);
    }
  });
  return Array.from(out).slice(0, max);
}

/** 关键词查询用的高区分度 token（去重后最多 12 个） */
function queryTokens(keyword) {
  return tokenize(keyword, 12);
}

module.exports = { tokenize, queryTokens };
