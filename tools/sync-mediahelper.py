"""把 mediahelper.js 的修复同步到全部 25 份副本。

背景：每个云函数目录都有一份 mediahelper.js（内容逐字相同），
改一份必须同步其余，否则行为不一致。

本脚本做三件事（幂等）：
  1. registerMedia 支持 inUse 参数（新记录 refCount=1，更新时补 1）
  2. 新增 isStillReferenced(fileId)：查 users.avatar / posts.media
  3. incRef 失败改为打印日志，不再静默吞错
"""
import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CF = os.path.join(ROOT, 'cloudfunctions')

# 以 meUpdateProfile 那份为基准（已修好）
SRC = os.path.join(CF, 'meUpdateProfile', 'lib', 'mediahelper.js')

OLD_REGISTER = """async function registerMedia({ fileId, uid, type, size, mime, w, h, duration, checkStatus, checkSource }) {
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
}"""

NEW_REGISTER = """async function registerMedia({ fileId, uid, type, size, mime, w, h, duration, checkStatus, checkSource, inUse }) {
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
    // 1. 用户头像
    const u = await coll(COL.users).where({ 'avatar.fileId': fileId }).limit(1).get();
    if (u.data && u.data.length) return true;
  } catch (e) { /* ignore */ }
  try {
    // 2. 帖子媒体（media 是数组，用 where 匹配数组元素）
    const p = await coll(COL.posts).where({ 'media.fileId': fileId, status: { $ne: 'deleted' } }).limit(1).get();
    if (p.data && p.data.length) return true;
  } catch (e) { /* ignore */ }
  return false;
}"""

OLD_INCREF = """async function incRef(fileId, delta) {
  if (!fileId) return;
  try {
    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();
    if (res.data && res.data.length) {
      const cur = Math.max(0, (res.data[0].refCount || 0) + delta);
      await coll(COL.mediaAssets).doc(res.data[0]._id).update({ data: { refCount: cur } });
    }
  } catch (e) { /* ignore */ }
}"""

NEW_INCREF = """async function incRef(fileId, delta) {
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
}"""

OLD_EXPORT = "module.exports = { verifyMedia, registerMedia, incRef, belongsTo, isAvatar, filePath };"
NEW_EXPORT = "module.exports = { verifyMedia, registerMedia, incRef, belongsTo, isAvatar, filePath, isStillReferenced };"


def main():
    base = open(SRC, encoding='utf-8').read()
    if 'isStillReferenced' not in base:
        print('❌ 基准文件 meUpdateProfile/lib/mediahelper.js 还没改好，先改它')
        return 1

    changed, skipped = [], []
    for fn in sorted(os.listdir(CF)):
        fd = os.path.join(CF, fn, 'lib')
        if not os.path.isdir(fd):
            continue
        p = os.path.join(fd, 'mediahelper.js')
        if not os.path.isfile(p):
            continue
        if os.path.abspath(p) == os.path.abspath(SRC):
            skipped.append(f'{fn}（基准）')
            continue
        t = open(p, encoding='utf-8').read()
        if 'isStillReferenced' in t:
            skipped.append(f'{fn}（已修）')
            continue
        orig = t
        t = t.replace(OLD_REGISTER, NEW_REGISTER)
        t = t.replace(OLD_INCREF, NEW_INCREF)
        t = t.replace(OLD_EXPORT, NEW_EXPORT)
        if t == orig:
            print(f'  ⚠️ {fn}: 模式未匹配，需手工检查')
            continue
        open(p, 'w', encoding='utf-8').write(t)
        changed.append(fn)

    print(f'=== 同步完成：改动 {len(changed)} 个 ===')
    for c in changed:
        print('  ', c)
    if skipped:
        print(f'  跳过 {len(skipped)} 个: {", ".join(skipped)}')

    # 复核：全部 md5 应该一致
    print('\n=== 复核（所有副本 md5 应相同）===')
    hashes = {}
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'mediahelper.js')
        if os.path.isfile(p):
            h = hashlib.md5(open(p, 'rb').read()).hexdigest()[:8]
            hashes.setdefault(h, []).append(fn)
    for h, fns in hashes.items():
        print(f'  {h}: {len(fns)} 个')
    return 0 if len(hashes) == 1 else 1


if __name__ == '__main__':
    sys.exit(main())
