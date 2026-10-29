/**
 * mediaCheck（9.19）
 * 下载送审图（前端上传时已压缩到 750px 的 checkFileId）→ imgSecCheck → 写 mediaAssets
 * 视频走封面图检测（微信无视频同步审核接口），结果一律保守置 review 交由人工复审
 */
const { cloud, coll, COL } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { imgSecCheck } = require('./lib/wxapi');
const { belongsTo, registerMedia, deriveCheckFileId } = require('./lib/mediahelper');
const { getConfig } = require('./lib/config');

const MAX_BYTES = 1024 * 1024; // imgSecCheck 上限 1MB

async function download(fileId) {
  const r = await cloud.downloadFile({ fileID: fileId });
  return r && r.fileContent;
}

exports.main = withAuth(async (event, ctx) => {
  const fileId = String(event.fileId || '').trim();
  const type = event.type === 'video' ? 'video' : 'image';

  if (!fileId) return fail(40001, '缺少文件 ID');
  if (!belongsTo(fileId, ctx.uid)) return fail(40401, '文件不存在或无权访问');

  const config = await getConfig();
  const maxMB = type === 'video'
    ? (config.limits && config.limits.maxVideoMB) || 30
    : (config.limits && config.limits.maxImageMB) || 5;

  // ⚠️ 送审图由服务端从 fileId 推导，**不接受客户端传的 checkFileId**。
  //    否则客户端可以传一张自己的干净图当 checkFileId：服务端拿干净图送审，
  //    却把「通过」结论写到违规的 fileId 上 → 违规图被放行。
  //    推导规则与前端上传约定一致（miniprogram/utils/media.js）：
  //      图片 p/{ym}/{uid}/{rand}.jpg     → p/{ym}/{uid}/{rand}_c.jpg
  //      视频 v/{ym}/{uid}/{rand}.mp4     → v/{ym}/{uid}/{rand}_poster.jpg
  const derived = deriveCheckFileId(fileId, type);
  // 推导不出送审图时退回审原图（宁可慢，也不能审错对象）
  const target = derived || fileId;

  let buffer = null;
  try {
    buffer = await download(target);
  } catch (e) {
    console.warn('[mediaCheck] 送审图下载失败，退回审原图:', e && (e.errMsg || e.message));
    if (target !== fileId) {
      try {
        buffer = await download(fileId);
      } catch (e2) {
        console.error('[mediaCheck] 原图也读不到', e2 && (e2.errMsg || e2.message));
      }
    }
  }
  if (!buffer) {
    // 两个都读不到：不阻断，保守置 review，由人工复核
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
