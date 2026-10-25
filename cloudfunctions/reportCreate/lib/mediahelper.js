/** 媒体归属与安全状态校验（11.3 / 16.3）：不信任前端传的 checkStatus */
const { coll, COL } = require('./db');

function filePath(fileId) {
  return String(fileId || '').replace(/^cloud:\/\/[^/]+\//, '');
}

function belongsTo(fileId, uid) {
  const p = filePath(fileId);
  if (!p) return false;
  return p.indexOf(`/${uid}/`) > -1;
}

function isAvatar(fileId) {
  return filePath(fileId).indexOf('avatar/') === 0;
}

/**
 * @returns {{ok:boolean, reason?:string, status?:string}}
 */
async function verifyMedia(fileId, uid) {
  if (!fileId) return { ok: false, reason: 'EMPTY' };
  if (!belongsTo(fileId, uid)) return { ok: false, reason: 'NOT_OWNER' };
  try {
    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();
    if (!res.data || !res.data.length) return { ok: true, status: 'unknown' };
    const st = res.data[0].checkStatus || 'pass';
    if (st === 'risky') return { ok: false, reason: 'RISKY', status: st };
    return { ok: true, status: st };
  } catch (e) {
    return { ok: true, status: 'unknown' };
  }
}

async function registerMedia({ fileId, uid, type, size, mime, w, h, duration, checkStatus, checkSource }) {
  if (!fileId) return;
  try {
    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();
    if (res.data && res.data.length) {
      await coll(COL.mediaAssets).doc(res.data[0]._id).update({
        data: { checkStatus: checkStatus || res.data[0].checkStatus, checkSource: checkSource || '' },
      });
      return;
    }
    await coll(COL.mediaAssets).add({
      data: {
        fileId,
        uid,
        type: type || 'image',
        size: size || 0,
        mime: mime || '',
        w: w || 0,
        h: h || 0,
        duration: duration || 0,
        checkStatus: checkStatus || 'pending',
        checkSource: checkSource || '',
        refCount: 0,
        createdAt: new Date(),
      },
    });
  } catch (e) {
    // 媒体台账失败不阻断业务
  }
}

async function incRef(fileId, delta) {
  if (!fileId) return;
  try {
    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();
    if (res.data && res.data.length) {
      const cur = Math.max(0, (res.data[0].refCount || 0) + delta);
      await coll(COL.mediaAssets).doc(res.data[0]._id).update({ data: { refCount: cur } });
    }
  } catch (e) { /* ignore */ }
}

module.exports = { verifyMedia, registerMedia, incRef, belongsTo, isAvatar, filePath };
