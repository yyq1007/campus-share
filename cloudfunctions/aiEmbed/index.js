/**
 * aiEmbed（9.21，内部函数）
 * 文本 = title + content + tags + fields（截断 1000 字）→ 768 维向量 → 写 vectors（postId 唯一）
 * 失败重试 3 次（指数退避），仍失败标 embedFailed 由 taskVectorize 兜底
 */
const { coll, COL, db, ms } = require('./lib/db');
const { embed, textHash, DIM, MODEL } = require('./lib/embed');

const MAX_RETRY = 3;

function buildText(p) {
  const fields = p.fields || {};
  const fieldText = Object.keys(fields).map((k) => `${k}:${fields[k]}`).join(' ');
  return `${p.title || ''}\n${p.content || ''}\n${(p.tags || []).join(' ')}\n${fieldText}`.slice(0, 1000);
}

exports.main = async (event) => {
  const postId = String((event && event.postId) || '').trim();
  if (!postId) return { ok: false, msg: 'missing postId' };

  let p = null;
  try {
    const r = await coll(COL.posts).doc(postId).get();
    p = r.data;
  } catch (e) {
    return { ok: false, msg: 'not found' };
  }
  if (!p) return { ok: false, msg: 'not found' };
  if (p.status !== 'published') return { ok: false, msg: 'not published' };

  const text = buildText(p);
  const hash = textHash(text);

  // 文本没变则复用已有向量
  try {
    const old = await coll(COL.vectors).where({ postId }).limit(1).get();
    if (old.data && old.data.length && old.data[0].textHash === hash) {
      return { ok: true, dim: old.data[0].dim || DIM, reused: true };
    }
  } catch (e) { /* ignore */ }

  let vec = null;
  let lastErr = null;
  for (let i = 0; i < MAX_RETRY; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      vec = embed(text);
      break;
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, i)));
    }
  }

  if (!vec) {
    console.error('[aiEmbed] failed', lastErr && lastErr.message);
    try {
      await coll(COL.posts).doc(postId).update({ data: { embedFailed: true } });
    } catch (e) { /* ignore */ }
    return { ok: false, msg: 'embed failed' };
  }

  try {
    const old = await coll(COL.vectors).where({ postId }).limit(1).get();
    if (old.data && old.data.length) {
      await coll(COL.vectors).doc(old.data[0]._id).update({
        data: { embedding: vec, dim: DIM, model: MODEL, textHash: hash, updatedAt: db.serverDate() },
      });
    } else {
      await coll(COL.vectors).add({
        data: {
          postId,
          textHash: hash,
          embedding: vec,
          dim: DIM,
          model: MODEL,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
    }
    await coll(COL.posts).doc(postId).update({ data: { embedFailed: false } }).catch(() => {});
  } catch (e) {
    console.error('[aiEmbed] write failed', e && e.message);
    await coll(COL.posts).doc(postId).update({ data: { embedFailed: true } }).catch(() => {});
    return { ok: false, msg: 'write failed' };
  }

  return { ok: true, dim: DIM, model: MODEL, at: ms(new Date()) };
};
