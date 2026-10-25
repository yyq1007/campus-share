/**
 * 媒体：选择 / 压缩 / 上传（并发 2、重试 2 次、750 宽送审图）
 * 图片仅 JPG/PNG（chooseMedia 已自动转码）；图视互斥
 */
const { randId } = require('./format')
const LIMITS = require('./config').LIMITS

function chooseImages(remain) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: Math.max(1, remain),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
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
        // 把微信侧真实 errMsg 透传出去（如「媒体文件无效」），便于定位是路径失效还是云存储配额/权限问题
        reject({
          code: -2,
          msg: '上传失败：' + String(err && err.errMsg || '').replace(/^cloud\.uploadFile:fail\s*/, ''),
          errMsg: err && err.errMsg,
          raw: err
        })
      }
    })
  })
}

/**
 * 上传一张图片：展示图 + 送审图，返回媒体记录
 * path 规则：p/{yyyyMM}/{uid}/{rand24}.jpg（送审图加 _c 后缀）
 * 压缩产物路径在部分真机可能失效（报「媒体文件无效」）→ 失败自动回退原图路径重传
 */
async function uploadImage(item, uid, onProgress) {
  const prep = await prepareImage(item)
  const ym = yyyyMM()
  const base = `p/${ym}/${uid}/${randId(24).toLowerCase()}`
  let fileId, checkFileId
  try {
    fileId = await uploadFile(`${base}.jpg`, prep.display)
  } catch (e) {
    fileId = await uploadFile(`${base}.jpg`, item.localPath)
  }
  try {
    checkFileId = await uploadFile(`${base}_c.jpg`, prep.check)
  } catch (e) {
    checkFileId = await uploadFile(`${base}_c.jpg`, item.localPath)
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
  let fileId
  try {
    fileId = await uploadFile(`${base}.mp4`, item.localPath)
  } catch (e) {
    console.error('[uploadVideo] 主文件上传失败', e)
    throw e // 视频本体没有回退路径，直接上抛
  }
  // 封面帧失败不阻塞发帖（posterFileId 允许为空）
  let posterFileId = ''
  if (item.thumb) {
    try {
      posterFileId = await uploadFile(`${base}_poster.jpg`, item.thumb)
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
  const path = await compressImage(localPath, 400, 80)
  try {
    return await uploadFile(`avatar/${uid}/${Date.now()}.jpg`, path)
  } catch (e) {
    return uploadFile(`avatar/${uid}/${Date.now()}.jpg`, localPath)
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
  chooseImages, chooseVideo, prepareImage, uploadImage, uploadVideo,
  uploadAvatar, uploadFile, getTempUrls, fileSize, compressImage
}
