/**
 * 图标统一引用：一律走包内路径 /assets/icons/
 * 注意：cloud:// fileID 不能直接用作 <image src>，cloudIcon() 仅为兼容保留，禁止用于渲染；
 * 用户上传的图片（帖子封面等）才需要云存储，由 utils/api.js 统一 getTempFileURL 转换。
 */
const { ICON_CLOUD_BASE, ICON_LOCAL_BASE } = require('./config')

function cloudIcon(name) {
  // ⚠️ 已废弃：返回的 cloud:// fileID 不可直接渲染，保留仅为历史引用不炸
  return ICON_CLOUD_BASE + name + '.png'
}

function localIcon(name) {
  return ICON_LOCAL_BASE + name + '.png'
}

module.exports = { cloudIcon, localIcon }
