/**
 * 格式化工具：相对时间、数字缩写、字符计数（与后端同口径：Array.from 计数）
 */

function timeAgo(ts) {
  if (!ts) return ''
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const min = 60 * 1000, hour = 60 * min, day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return Math.floor(diff / min) + ' 分钟前'
  if (diff < day) return Math.floor(diff / hour) + ' 小时前'
  if (diff < 30 * day) return Math.floor(diff / day) + ' 天前'
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function countShort(n) {
  n = Number(n) || 0
  if (n > 999) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

/** 字符计数：emoji 记 1（与后端 [...str].length 同口径） */
function countChars(str) {
  return str ? Array.from(str).length : 0
}

/** 按字符数截断（与 countChars 同口径：Array.from，不会把 emoji 劈成乱码） */
function clipChars(str, max) {
  if (!str) return ''
  const arr = Array.from(str)
  if (arr.length <= max) return str
  return arr.slice(0, max).join('')
}

/** 连续空白压缩为 1 个 + 首尾 trim（提交时处理） */
function normalizeText(str) {
  return (str || '').replace(/\s+/g, ' ').trim()
}

/** 正文保留换行的清洗：去掉首尾空白、行尾空格 */
function cleanContent(str) {
  return (str || '')
    .split('\n')
    .map(s => s.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 链接格式校验：http(s)、无空格、非伪协议 */
function validLink(s) {
  if (!s) return true
  if (/\s/.test(s)) return false
  if (/^javascript:|^data:|^vbscript:/i.test(s)) return false
  return /^https?:\/\/.{3,}$/.test(s)
}

function linkHost(s) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(s || '')
  return m ? m[1] : ''
}

/** 头像糖果色序号：uid 取模（个人主页头像，按人取色是合理的） */
function avatarIndex(uid) {
  if (!uid) return 1
  let h = 0
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 5) + 1
}

/**
 * 评论头像糖果色序号：按楼层号取模。
 * 与 avatarIndex 同算法但入参不同 —— 评论头像按楼层取色而非按作者取色：
 * 若按作者取色，同一作者所有评论同色 → 等于用颜色重建作者画像，破坏匿名定位。
 * 与服务端 present.js 的 avatarIndex(floor) 同口径。
 */
function commentAvatarIndex(floor) {
  const n = Number(floor) || 0
  if (!n) return 1
  let h = 0
  for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 5) + 1
}

function randId(len = 16) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

module.exports = { timeAgo, countShort, countChars, clipChars, normalizeText, cleanContent, validLink, linkHost, avatarIndex, commentAvatarIndex, randId }
