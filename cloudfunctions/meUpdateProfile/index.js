/**
 * meUpdateProfile（9.25）
 * 校验头像归属（必须在 avatar/ 目录且属于本人）→ 写 pending → 送审 → pass/清空
 * 送审异常保留 pending 不阻断；risky 清空并给一条站内提示
 */
const { cloud, coll, COL, db, _ } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const { imgSecCheck } = require('./lib/wxapi');
const { belongsTo, isAvatar, registerMedia } = require('./lib/mediahelper');
const { getConfig } = require('./lib/config');
const rate = require('./lib/rate');
const msg = require('./lib/msg');

const HOUR = 60 * 60 * 1000;
const MAX_BYTES = 1024 * 1024;

async function download(fileId) {
  try {
    const r = await cloud.downloadFile({ fileID: fileId });
    return (r && r.fileContent) || null;
  } catch (e) {
    return null;
  }
}

exports.main = withAuth(async (event, ctx) => {
  // 频控已移除（测试期不受限；上线前如需防滥用可恢复 avatarPerHour 限流）

  const raw = event.avatarFileId;

  // null / '' 表示恢复默认
  if (raw === null || raw === '') {
    try {
      const r = await coll(COL.users).where({ _id: ctx.uid }).update({ data: { avatar: null, updatedAt: db.serverDate() } });
      if (!r.stats || !r.stats.updated) throw new Error('user doc missing');
    } catch (e) {
      console.error('[meUpdateProfile] reset avatar failed', e && (e.errMsg || e.message));
      return fail(50001, '服务异常:' + (e && (e.errMsg || e.message) || '写库失败'));
    }
    return ok({ avatar: null });
  }

  const fileId = String(raw || '').trim();
  if (!fileId) return fail(40001, '缺少头像文件');
  if (!belongsTo(fileId, ctx.uid) || !isAvatar(fileId)) return fail(40401, '头像文件不存在或不属于你');

  const checkFileId = String(event.checkFileId || '').trim() || fileId;

  // 先写 pending，保证前端立即可见
  // ⚠️ 必须用 _.set 整体替换：avatar 现值可能是 null，嵌套展开写法（avatar.fileId）
  // 会触发「Cannot create field in element {avatar: null}」数据库错误
  try {
    const r = await coll(COL.users).where({ _id: ctx.uid }).update({
      data: { avatar: _.set({ fileId, status: 'pending' }), updatedAt: db.serverDate() },
    });
    if (!r.stats || !r.stats.updated) throw new Error('user doc missing');
  } catch (e) {
    console.error('[meUpdateProfile] pending write failed', e && (e.errMsg || e.message));
    return fail(50001, '服务异常:' + (e && (e.errMsg || e.message) || '写库失败'));
  }
  await registerMedia({ fileId, uid: ctx.uid, type: 'image', checkStatus: 'pending', checkSource: 'avatar' });

  const buf = await download(checkFileId);
  if (!buf || !buf.length || buf.length > MAX_BYTES) {
    // 读不到/超限：保留 pending，不阻断使用
    return ok({ avatar: { fileId, status: 'pending' }, degraded: true });
  }

  const r = await imgSecCheck(buf, 'image/jpeg');

  if (r.status === 'pass') {
    try {
      await coll(COL.users).where({ _id: ctx.uid }).update({
        data: { avatar: _.set({ fileId, status: 'pass' }), updatedAt: db.serverDate() },
      });
    } catch (e) {
      // 二次更新失败不阻断：头像已 pending 可见，等待下次复审/重试
      console.error('[meUpdateProfile] pass write failed', e && (e.errMsg || e.message));
    }
    await registerMedia({ fileId, uid: ctx.uid, type: 'image', size: buf.length, checkStatus: 'pass', checkSource: 'wx' });
    return ok({ avatar: { fileId, status: 'pass' } });
  }

  if (r.status === 'risky') {
    try {
      await coll(COL.users).where({ _id: ctx.uid }).update({ data: { avatar: null, updatedAt: db.serverDate() } });
    } catch (e) {
      console.error('[meUpdateProfile] risky reset failed', e && (e.errMsg || e.message));
    }
    await registerMedia({ fileId, uid: ctx.uid, type: 'image', size: buf.length, checkStatus: 'risky', checkSource: 'wx' });
    await msg.push({
      toUid: ctx.uid,
      type: 'system',
      title: '头像未通过审核',
      body: '你上传的头像含有不合规内容，已恢复默认头像，请更换后再试。',
      refType: 'post',
      refId: '',
    }).catch(() => {});
    return ok({ avatar: { fileId: '', status: 'risky' } });
  }

  // review / 接口异常：保留 pending，人工或下次复审
  await registerMedia({
    fileId,
    uid: ctx.uid,
    type: 'image',
    size: buf.length,
    checkStatus: 'review',
    checkSource: r.degraded ? 'degraded' : 'wx',
  });
  return ok({ avatar: { fileId, status: 'review' }, degraded: !!r.degraded });
}, { write: true });
