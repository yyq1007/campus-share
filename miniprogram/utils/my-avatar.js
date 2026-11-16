/**
 * 我的头像 URL 解析（带缓存）：发过的帖子在自己可见时显示真实头像，
 * 他人视角仍是匿名糖果色（posts 只下发 isMine 标记，不下发任何作者信息）。
 * meOverview.avatar 是 {fileId,status} 对象 → getTempUrls 换临时链接（30 分钟有效，这里 10 分钟刷新）
 */
const api = require('./api')
const { getTempUrls } = require('./media')

const TTL = 10 * 60 * 1000
let cache = { url: '', at: 0, inflight: null }

async function getMyAvatarUrl(force) {
  const now = Date.now()
  if (!force && cache.url && now - cache.at < TTL) return cache.url
  if (!force && cache.url === '' && cache.at && now - cache.at < TTL) return '' // 近期确认无头像
  if (cache.inflight) return cache.inflight
  cache.inflight = (async () => {
    try {
      const res = await api.meOverview()
      const avatar = res && res.avatar
      const fileId = avatar && typeof avatar === 'object' ? avatar.fileId : avatar
      if (!fileId || (avatar && avatar.status === 'risky')) {
        cache = { url: '', at: Date.now(), inflight: null }
        return ''
      }
      const map = await getTempUrls([fileId])
      const url = map[fileId] || ''
      cache = { url, at: Date.now(), inflight: null }
      return url
    } catch (e) {
      cache.inflight = null
      return ''
    }
  })()
  return cache.inflight
}

module.exports = { getMyAvatarUrl }
