/**
 * 媒体：选择 / 压缩 / 上传（并发 2、重试 2 次、750 宽送审图）
 * 图片仅 JPG/PNG（chooseMedia 已自动转码）；图视互斥
 */
const { randId } = require('./format')
const LIMITS = require('./config').LIMITS

function chooseImages(remain, sourceType) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: Math.max(1, remain),
      mediaType: ['image'],
      // 默认只从相册选：chooseMedia 的拍照会强制存入系统相册（平台行为），
      // 需要拍照的入口一律走页面内 camera 组件 takePhoto（只出临时文件）
      sourceType: sourceType || ['album'],
      sizeType: ['compressed'],
      camera: 'back',
      success: res => {
        const items = res.tempFiles.map(f => ({
          type: 'image',
          localPath: f.tempFilePath,
          size: f.size,
          w: f.width,
          h: f.height
        }))
        resolve(items)
      },
      fail: err => reject(err)
    })
  })
}

/**
 * 单选一张图（拍照即发帖专用）：sourceType 按弹层入口区分 camera | album
 * 独立于 chooseImages：那边是多选补图，这边是「选定即分析」的单张主图
 */
function chooseSingleImage(sourceType) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [sourceType === 'camera' ? 'camera' : 'album'],
      sizeType: ['compressed'],
      camera: 'back',
      success: res => {
        const f = res.tempFiles[0]
        if (!f) return reject({ code: 40001, msg: '未选择图片' })
        resolve({
          type: 'image',
          localPath: f.tempFilePath,
          size: f.size,
          w: f.width,
          h: f.height
        })
      },
      fail: err => reject(err)
    })
  })
}

function chooseVideo() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: LIMITS.videoSeconds,
      camera: 'back',
      success: res => {
        const f = res.tempFiles[0]
        if (f.duration && f.duration > LIMITS.videoSeconds + 5) {
          return reject({ code: 40001, msg: `视频最长 ${LIMITS.videoSeconds} 秒` })
        }
        if (f.size > LIMITS.maxVideoMB * 1024 * 1024) {
          return reject({ code: 40001, msg: `视频不能超过 ${LIMITS.maxVideoMB}MB` })
        }
        resolve([{
          type: 'video',
          localPath: f.tempFilePath,
          thumb: f.thumbTempFilePath,
          size: f.size,
          duration: Math.round(f.duration || 0)
        }])
      },
      fail: err => reject(err)
    })
  })
}

/** 图片二次压缩：展示图 1280 宽；返回 { path, size } */
function compressImage(src, width, quality) {
  return new Promise(resolve => {
    wx.compressImage({
      src,
      quality,
      compressedWidth: width,
      success: r => resolve(r.tempFilePath || src), // 部分机型成功但返回空路径 → 回退原图
      fail: () => resolve(src) // 低版本不支持 compressedWidth 时回退原图
    })
  })
}

async function prepareImage(item) {
  // 展示图 1280 宽
  let path = item.localPath
  path = await compressImage(path, 1280, 80)
  // 若仍 >1MB 逐级再压
  for (const q of [60, 40]) {
    const size = await fileSize(path)
    if (size <= LIMITS.maxImageMB * 1024 * 1024) break
    path = await compressImage(path, 1280, q)
  }
  // 送审图 750 宽（imgSecCheck 尺寸硬限制 ≤750×1334）
  const checkPath = await compressImage(item.localPath, 750, 70)
  return { display: path, check: checkPath }
}

function fileSize(path) {
  return new Promise(resolve => {
    wx.getFileInfo({ filePath: path, success: r => resolve(r.size), fail: () => resolve(0) })
  })
}

// ---------- 本地文件保障（2026-11-16：修复草稿恢复后上传报 file doesn't exist） ----------
// 临时路径跨会话会失效；草稿恢复还可能把 localPath 换成远程 URL，
// 而 wx.cloud.uploadFile 只认本地文件 → 上传前统一「落本地」
const FSM = wx.getFileSystemManager()

function fileExists(path) {
  return new Promise(resolve => {
    if (!path || /^(https?|cloud):/i.test(path)) return resolve(false)
    FSM.access({ path, success: () => resolve(true), fail: () => resolve(false) })
  })
}

/** cloud:// 文件 ID → 本地临时文件 */
function downloadCloudFile(fileId) {
  return wx.cloud.downloadFile({ fileID: fileId }).then(r => r.tempFilePath)
}

/** https 图片 → 本地临时文件 */
function downloadHttpFile(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: r => r.statusCode === 200 ? resolve(r.tempFilePath)
        : reject({ code: -3, msg: '图片下载失败（' + r.statusCode + '）' }),
      fail: () => reject({ code: -3, msg: '图片下载失败，请检查网络' })
    })
  })
}

/**
 * 把任意来源的图片引用转成可上传的本地路径：
 * cloud:// → 云端下载；http(s) → 本地下载；本地路径 → 校验存在
 * 失效抛 { code:-3, msg:'图片文件已失效…' }，调用方可回退 fileId
 */
async function ensureLocalFile(path) {
  if (!path) throw { code: -3, msg: '图片文件缺失，请删除后重新选择' }
  if (/^cloud:/i.test(path)) return downloadCloudFile(path)
  if (/^https?:\/\//i.test(path)) return downloadHttpFile(path)
  if (await fileExists(path)) return path
  throw { code: -3, msg: '图片文件已失效，请删除后重新选择' }
}

// ---------- 草稿媒体持久化（2026-11-16 用户反馈「旧草稿的图用不了」） ----------
// 临时文件（wxfile://tmp_*）跨会话必失效 → 存草稿时复制一份到 USER_DATA_PATH
// （该目录随小程序存续，不被临时清理），恢复时优先用持久副本
const DRAFT_MEDIA_DIR = `${wx.env.USER_DATA_PATH}/draft_media`

function ensureDraftDir() {
  try { FSM.mkdir({ dirPath: DRAFT_MEDIA_DIR, recursive: true }) } catch (e) { /* 已存在或失败 */ }
}

/** 草稿媒体条目 → 持久副本路径；已持久化原样返回、远程 URL 返回 ''、复制失败返回 '' */
function persistDraftMedia(m) {
  return new Promise(resolve => {
    if (!m) return resolve('')
    if (m.persistPath) return resolve(m.persistPath) // 已有持久副本，不重复拷贝
    const src = m.localPath
    if (!src || /^https?:|^cloud:/i.test(src)) return resolve('')
    ensureDraftDir()
    const dest = `${DRAFT_MEDIA_DIR}/d${randId(16)}${m.type === 'video' ? '.mp4' : '.jpg'}`
    FSM.copyFile({ srcPath: src, destPath: dest, success: () => resolve(dest), fail: () => resolve('') })
  })
}

/** 恢复草稿：原临时路径失效但持久副本仍在 → 换用持久路径，图片照常可用 */
function reviveDraftMedia(media) {
  for (const m of media || []) {
    if (!m || !m.persistPath) continue
    if (!m.localPath) { m.localPath = m.persistPath; continue }
    try { FSM.accessSync(m.localPath) } catch (e) { m.localPath = m.persistPath }
  }
  return media
}

/** 删除持久副本（草稿删除/淘汰/发布成功时调用，防 USER_DATA_PATH 膨胀） */
function removeDraftMedia(media) {
  for (const m of media || []) {
    if (m && m.persistPath && m.persistPath.indexOf(DRAFT_MEDIA_DIR) === 0) {
      try { FSM.unlink({ filePath: m.persistPath }) } catch (e) { /* */ }
    }
  }
}

function uploadFile(cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: r => {
        if (r.fileID) resolve(r.fileID)
        else reject({ code: -2, msg: '上传失败（空结果）', errMsg: 'upload empty' })
      },
      fail: err => {
        console.error('[uploadFile]', cloudPath, err)
        // 把微信侧真实 errMsg 透传出去，便于定位是路径失效还是云存储配额/权限问题
        const rawMsg = String(err && err.errMsg || '')
          .replace(/^(cloud\.)?uploadFile:fail\s*/i, '')
        // 常见失败翻译成人话（2026-11-16：file doesn't exist = 本地临时文件已失效）
        const friendly = /file doesn'?t exist/i.test(rawMsg) ? '图片文件已失效，请删除后重新选择'
          : /exceed/i.test(rawMsg) ? '文件过大'
          : rawMsg
        reject({
          code: -2,
          msg: '上传失败：' + friendly,
          errMsg: err && err.errMsg,
          raw: err
        })
      }
    })
  })
}

/** 上传前先拿到可用的本地文件：临时路径失效时回退 cloud:// 取回 */
async function resolveUploadSource(item) {
  try {
    return await ensureLocalFile(item.localPath)
  } catch (e) {
    if (item.fileId) return downloadCloudFile(item.fileId) // 本地失效但有云端副本 → 取回
    throw e
  }
}

/**
 * 上传一张图片：展示图 + 送审图，返回媒体记录
 * path 规则：p/{yyyyMM}/{uid}/{rand24}.jpg（送审图加 _c 后缀）
 * 压缩产物路径在部分真机可能失效（报「媒体文件无效」）→ 失败自动回退原图路径重传
 */
async function uploadImage(item, uid, onProgress) {
  // 临时路径失效 / 远程 URL → 先落到本地；本地失效且有 fileId → 从云端取回
  const src = await resolveUploadSource(item)
  const prep = await prepareImage({ ...item, localPath: src })
  const ym = yyyyMM()
  const base = `p/${ym}/${uid}/${randId(24).toLowerCase()}`
  let fileId, checkFileId
  try {
    fileId = await uploadFile(`${base}.jpg`, prep.display)
  } catch (e) {
    fileId = await uploadFile(`${base}.jpg`, src)
  }
  try {
    checkFileId = await uploadFile(`${base}_c.jpg`, prep.check)
  } catch (e) {
    checkFileId = await uploadFile(`${base}_c.jpg`, src)
  }
  if (onProgress) onProgress(100)
  return {
    type: 'image', fileId, checkFileId,
    size: await fileSize(prep.display),
    mime: 'image/jpeg',
    w: item.w || 0, h: item.h || 0
  }
}

async function uploadVideo(item, uid) {
  const ym = yyyyMM()
  const base = `v/${ym}/${uid}/${randId(24).toLowerCase()}`
  // 视频本体同样先落本地（跨会话恢复的草稿可能拿到失效临时路径）
  let src
  try {
    src = await ensureLocalFile(item.localPath)
  } catch (e) {
    if (item.fileId) src = await downloadCloudFile(item.fileId)
    else throw e
  }
  let fileId
  try {
    fileId = await uploadFile(`${base}.mp4`, src)
  } catch (e) {
    console.error('[uploadVideo] 主文件上传失败', e)
    throw e // 视频本体没有回退路径，直接上抛
  }
  // 封面帧失败不阻塞发帖（posterFileId 允许为空）
  let posterFileId = ''
  if (item.thumb) {
    try {
      const thumbPath = await ensureLocalFile(item.thumb)
      posterFileId = await uploadFile(`${base}_poster.jpg`, thumbPath)
    } catch (e) {
      console.error('[uploadVideo] 封面上传失败，跳过', e)
    }
  }
  return {
    type: 'video', fileId, posterFileId,
    size: item.size, duration: item.duration || 0,
    mime: 'video/mp4', checkFileId: posterFileId
  }
}

/** 头像上传：400×400，路径 avatar/{uid}/{ts}.jpg；压缩产物失效回退原图 */
async function uploadAvatar(localPath, uid) {
  const src = await ensureLocalFile(localPath) // 远程 URL / 失效路径先落本地
  const path = await compressImage(src, 400, 80)
  try {
    return await uploadFile(`avatar/${uid}/${Date.now()}.jpg`, path)
  } catch (e) {
    return uploadFile(`avatar/${uid}/${Date.now()}.jpg`, src)
  }
}

function yyyyMM() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 云文件 ID 批量换 https 临时链接（本地缓存 30 分钟） */
const tempUrlCache = {}
async function getTempUrls(fileIds) {
  const ids = [...new Set((fileIds || []).filter(Boolean))]
  const need = ids.filter(id => !tempUrlCache[id] || Date.now() - tempUrlCache[id].at > 30 * 60 * 1000)
  if (need.length) {
    const res = await wx.cloud.getTempFileURL({ fileList: need })
    for (const f of res.fileList || []) {
      if (f.tempFileURL) tempUrlCache[f.fileID] = { url: f.tempFileURL, at: Date.now() }
    }
  }
  const map = {}
  for (const id of ids) map[id] = tempUrlCache[id] ? tempUrlCache[id].url : ''
  return map
}

module.exports = {
  chooseImages, chooseSingleImage, chooseVideo, prepareImage, uploadImage, uploadVideo,
  uploadAvatar, uploadFile, getTempUrls, fileSize, compressImage,
  ensureLocalFile, fileExists, persistDraftMedia, reviveDraftMedia, removeDraftMedia
}
