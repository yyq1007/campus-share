/**
 * wxacodeGen（9.18）
 * qrcodes 集合做全局缓存（同一 scene 只生成一次），scene 字符集 a-zA-Z0-9:_- 且 ≤32
 * checkPath:false 允许未发布页面（体验版必需）
 */
const { cloud, coll, _, COL, db } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { getConfig } = require('./lib/config');
const rate = require('./lib/rate');

const DAY = 24 * 60 * 60 * 1000;
const SCENE_RE = /^[a-zA-Z0-9:_-]{1,32}$/;
const DEFAULT_PAGE = 'pages/index/index';

function envVersion() {
  const v = String(process.env.WX_ENV_VERSION || 'trial');
  return v === 'release' ? 'release' : v === 'develop' ? 'develop' : 'trial';
}

async function tempUrl(fileId) {
  try {
    const r = await cloud.getTempFileURL({ fileList: [fileId] });
    const f = (r.fileList || [])[0];
    return (f && f.tempFileURL) || '';
  } catch (e) {
    return '';
  }
}

exports.main = withAuth(async (event, ctx) => {
  const scene = String(event.scene || '').trim();
  const page = String(event.page || DEFAULT_PAGE).trim();
  const width = Math.max(280, Math.min(Number(event.width) || 430, 1280));

  if (!scene) return fail(40001, '缺少 scene');
  if (!SCENE_RE.test(scene)) return fail(40001, 'scene 只能包含字母、数字、冒号、下划线、短横线，且不超过 32 位');
  if (!/^pages\//.test(page)) return fail(40001, '页面路径不合法');

  // 命中缓存直接返回
  try {
    const hit = await coll(COL.qrcodes).where({ scene }).limit(1).get();
    if (hit.data && hit.data.length) {
      const doc = hit.data[0];
      let url = await tempUrl(doc.fileId);
      if (!url) {
        // 文件被清理：重新生成
        await coll(COL.qrcodes).doc(doc._id).remove().catch(() => {});
      } else {
        await coll(COL.qrcodes).doc(doc._id).update({ data: { hitCount: _.inc(1) } }).catch(() => {});
        return ok({ fileId: doc.fileId, tempUrl: url, expiresAt: Date.now() + 2 * 3600 * 1000, cached: true });
      }
    }
  } catch (e) { /* 查询失败继续生成 */ }

  const config = await getConfig();
  const limit = (config.limits && config.limits.qrcodePerDay) || 5;
  const rl = await rate.hit(ctx.uid, 'wxacodeGen', limit, DAY);
  if (!rl.allowed) return fail(42901, `今天最多生成 ${limit} 次小程序码`);

  let buffer = null;
  try {
    const res = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page,
      width,
      checkPath: false,
      envVersion: envVersion(),
    });
    buffer = res && res.buffer;
  } catch (e) {
    const code = e && (e.errCode !== undefined ? e.errCode : e.code);
    const detail = (e && (e.errMsg || e.message)) || '';
    console.error('[wxacodeGen] openapi failed', code, detail);
    return fail(50005, `小程序码生成失败（${code || '未知'}）`);
  }
  if (!buffer) return fail(50005, '小程序码生成失败');

  const cloudPath = `qrcode/${scene}.png`;
  let fileId = '';
  try {
    const up = await cloud.uploadFile({ cloudPath, fileContent: buffer });
    fileId = up.fileID;
  } catch (e) {
    console.error('[wxacodeGen] upload failed', e && e.message);
    return fail(50004, '小程序码上传失败');
  }

  try {
    await coll(COL.qrcodes).add({
      data: {
        scene,
        page,
        fileId,
        width,
        envVersion: envVersion(),
        hitCount: 1,
        createdBy: ctx.uid,
        createdAt: db.serverDate(),
      },
    });
  } catch (e) { /* 并发新增冲突：忽略，缓存仍可用 */ }

  return ok({ fileId, tempUrl: await tempUrl(fileId), expiresAt: Date.now() + 2 * 3600 * 1000, cached: false });
}, {});
