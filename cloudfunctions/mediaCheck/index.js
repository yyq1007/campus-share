/**
 * mediaCheck（9.19）
 * 下载送审图（前端上传时已压缩到 750px 的 checkFileId）→ imgSecCheck → 写 mediaAssets
 * 视频走封面图检测（微信无视频同步审核接口），结果一律保守置 review 交由人工复审
 */
const { cloud, coll, COL } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { imgSecCheck } = require('./lib/wxapi');
const { belongsTo, registerMedia } = require('./lib/mediahelper');
const { getConfig } = require('./lib/config');

const MAX_BYTES = 1024 * 1024; // imgSecCheck 上限 1MB

async function download(fileId) {
  const r = await cloud.downloadFile({ fileID: fileId });
  return r && r.fileContent;
}

exports.main = withAuth(async (event, ctx) => {
  const fileId = String(event.fileId || '').trim();
  const checkFileId = String(event.checkFileId || '').trim();
  const type = event.type === 'video' ? 'video' : 'image';

  if (!fileId) return fail(40001, '缺少文件 ID');
  if (!belongsTo(fileId, ctx.uid)) return fail(40401, '文件不存在或无权访问');

  const config = await getConfig();
  const maxMB = type === 'video'
    ? (config.limits && config.limits.maxVideoMB) || 30
    : (config.limits && config.limits.maxImageMB) || 5;

  // 送审图：优先用前端生成的压缩图
  const target = checkFileId || fileId;
  let buffer = null;
  try {
    buffer = await download(target);
  } catch (e) {
    console.error('[mediaCheck] download failed', e && e.message);
    // 读不到送审图时不阻断：保守置 review，由人工复核
    await registerMedia({ fileId, uid: ctx.uid, type, checkStatus: 'review', checkSource: 'download_failed' });
    return ok({ checkStatus: 'review', labels: [], degraded: true });
  }

  if (!buffer || !buffer.length) {
    await registerMedia({ fileId, uid: ctx.uid, type, checkStatus: 'review', checkSource: 'empty' });
    return ok({ checkStatus: 'review', labels: [], degraded: true });
  }

  if (buffer.length > MAX_BYTES) {
    // 超过接口限制：不做同步检测，交人工
    await registerMedia({ fileId, uid: ctx.uid, type, checkStatus: 'review', checkSource: 'oversize' });
    return ok({ checkStatus: 'review', labels: [], degraded: true });
  }

  const r = await imgSecCheck(buffer, 'image/jpeg');

  let checkStatus = r.status; // pass / review / risky
  let source = r.degraded ? 'degraded' : 'wx';

  // 视频即使封面通过也仍需人工复审（11.4）
  if (type === 'video' && checkStatus === 'pass') {
    checkStatus = 'review';
    source = 'video_manual';
  }

  await registerMedia({
    fileId,
    uid: ctx.uid,
    type,
    size: buffer.length,
    mime: 'image/jpeg',
    checkStatus,
    checkSource: source,
  });

  console.log('[mediaCheck]', JSON.stringify({ uid: ctx.uid, type, checkStatus, source, size: buffer.length, maxMB }));

  return ok({ checkStatus, labels: r.label ? [r.label] : [], degraded: !!r.degraded });
}, { write: true });
