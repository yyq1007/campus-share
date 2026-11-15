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
 * 由「原图 fileId」推导「送审图 fileId」。
 *
 * 前端上传约定（见 miniprogram/utils/media.js）：
 *   展示图 p/{yyyyMM}/{uid}/{rand}.jpg
 *   送审图 p/{yyyyMM}/{uid}/{rand}_c.jpg   ← 同目录、同 basename、加 _c 后缀
 *   视频封面 v/{yyyyMM}/{uid}/{rand}_poster.jpg
 *
 * ⚠️ 为什么不用客户端传的 checkFileId：
 *   客户端可以传任意一张自己的"干净图"当 checkFileId，
 *   服务端拿干净图送审、却把结论写到违规的 fileId 上 → 违规图被放行。
 *   所以送审图必须由服务端从 fileId 推导，不可由客户端指定。
 *
 * @returns {string} 推导出的送审图 fileId；无法推导时返回空串
 */
function deriveCheckFileId(fileId, type) {
  const raw = String(fileId || '');
  if (!raw) return '';
  // 拆出 cloud://env.xxx/ 前缀与内部路径（filePath 只给内部路径，这里要保留前缀才能下载）
  const m = raw.match(/^(cloud:\/\/[^/]+\/)(.*)$/);
  const prefix = m ? m[1] : '';
  const p = m ? m[2] : raw;
  if (!p) return '';
  const ext = type === 'video' ? '_poster.jpg' : '_c.jpg';
  const base = p.replace(/\.[^./]+$/, '');
  if (base === p) return ''; // 没有扩展名，推导失败
  return `${prefix}${base}${ext}`;
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

async function registerMedia({ fileId, uid, type, size, mime, w, h, duration, checkStatus, checkSource, inUse }) {
  if (!fileId) return;
  try {
    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();
    if (res.data && res.data.length) {
      await coll(COL.mediaAssets).doc(res.data[0]._id).update({
        data: {
          checkStatus: checkStatus || res.data[0].checkStatus,
          checkSource: checkSource || '',
          // inUse 为真且当前未计数时补 1（头像等"始终在用"的资源）
          ...(inUse && !(res.data[0].refCount > 0) ? { refCount: 1 } : {}),
        },
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
        // inUse：头像这类"注册即在用"的资源初始计数为 1，
        // 否则会被 taskCleanup 当成 24h 未引用的垃圾删掉（头像变空白）
        refCount: inUse ? 1 : 0,
        createdAt: new Date(),
      },
    });
  } catch (e) {
    // 媒体台账失败不阻断业务
  }
}

/**
 * 该文件是否仍被引用（用户头像 / 帖子媒体）。
 * 供 taskCleanup 删除前二次校验，避免误删在用资源。
 */
async function isStillReferenced(fileId) {
  if (!fileId) return false;
  try {
    // 1. 用户头像（avatar 是 {fileId, status} 对象）
    const u = await coll(COL.users).where({ 'avatar.fileId': fileId }).limit(1).get();
    if (u.data && u.data.length) return true;
  } catch (e) { /* ignore */ }
  try {
    // 2. 帖子媒体（media 是数组，'media.fileId' 匹配数组元素）
    // ⚠️ 不要加 status: {$ne:'deleted'} —— 实测带 $ne 的数组字段查询
    //    一条都匹配不到，会让二次校验形同虚设（被删帖子的图也判成"没引用"）。
    //    已删除的帖子媒体被清理本来就是期望行为，多留一次不扣分。
    const p = await coll(COL.posts).where({ 'media.fileId': fileId }).limit(1).get();
    if (p.data && p.data.length) return true;
  } catch (e) { /* ignore */ }
  return false;
}

async function incRef(fileId, delta) {
  if (!fileId) return;
  try {
    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();
    if (res.data && res.data.length) {
      const cur = Math.max(0, (res.data[0].refCount || 0) + delta);
      await coll(COL.mediaAssets).doc(res.data[0]._id).update({ data: { refCount: cur } });
    } else {
      // 台账里没有这条记录 → 计数无从谈起，告警（不静默吞掉）
      console.warn('[incRef] mediaAssets 无此记录，refCount 未变更:', fileId);
    }
  } catch (e) {
    // ⚠️ 不再静默：计数失败会导致文件被 taskCleanup 误删，必须留日志
    console.error('[incRef] 引用计数更新失败:', fileId, delta, e && (e.errMsg || e.message));
  }
}

module.exports = { verifyMedia, registerMedia, incRef, belongsTo, isAvatar, filePath, isStillReferenced, deriveCheckFileId };
