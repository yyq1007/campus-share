/**
 * 本地向量化（9.20 / 9.21 的降级实现）
 * 未接入大模型向量接口时，用「2-gram 词袋 + 特征哈希 + L2 归一化」得到 768 维向量。
 * 优点：零依赖、确定性、冷启动快；与余弦检索配合后对站内短文本召回足够。
 * 换用真实 embedding 模型时，只要保持 DIM 一致，写入/检索代码无需改动。
 */
const { tokenize } = require('./tokenize');

const DIM = 768;
const MODEL = 'local-hash-768';

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embed(text) {
  const v = new Float64Array(DIM);
  const toks = tokenize(String(text || '').slice(0, 1000), 400);
  toks.forEach((t) => {
    const h = hash32(t);
    const idx = h % DIM;
    const sign = (h >>> 15) & 1 ? -1 : 1;
    // 长词权重略高，抑制高频单字噪声
    v[idx] += sign * (t.length > 1 ? 1.2 : 0.8);
  });
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  const out = new Array(DIM);
  for (let i = 0; i < DIM; i += 1) out[i] = norm > 0 ? v[i] / norm : 0;
  return out;
}

/** 两枚已归一化向量的余弦相似度 */
function cosine(a, b) {
  if (!a || !b) return 0;
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

function textHash(text) {
  return hash32(String(text || '').slice(0, 1000)).toString(16);
}

module.exports = { embed, cosine, textHash, DIM, MODEL };
