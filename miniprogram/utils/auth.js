/**
 * 登录态：无感登录（authLogin 云函数，openid 主键）+ 邀请码门禁
 * - 单飞锁：并发调用复用同一 Promise
 * - globalData.profile 缓存 5 分钟
 * 契约见 MVP 文档 9.2：needInvite=true 表示尚未绑定邀请码
 */
const api = require('./api')
const { preserveAcrossClear, hasAgreed } = require('./privacy')

let inflight = null

function clearLogin() {
  const app = getApp()
  app.globalData.profile = null
  app.globalData.profileAt = 0
  // 退出登录只清业务缓存，隐私协议的同意标记要保留（否则登出一次就被迫重弹协议）
  const keep = preserveAcrossClear()
  try { wx.clearStorageSync() } catch (e) { /* 忽略 */ }
  keep.restore()
}

function ensureLogin({ force = false } = {}) {
  const app = getApp()
  const now = Date.now()
  if (!force && app.globalData.profile && now - app.globalData.profileAt < 5 * 60 * 1000) {
    return Promise.resolve(app.globalData.profile)
  }
  if (inflight) return inflight

  inflight = api.login()
    .then(profile => {
      inflight = null
      // 未绑定邀请码 → 跳邀请码页（已注册过的用户不会再触发）
      if (profile.needInvite) {
        app.globalData.profile = null
        app.globalData.profileAt = 0
        wx.reLaunch({ url: '/pages/auth/invite/invite' })
        return Promise.reject({ code: 40101, msg: 'needInvite', silent: true })
      }
      app.globalData.profile = profile
      app.globalData.profileAt = Date.now()
      return profile
    })
    .catch(err => {
      inflight = null
      // 封禁账号
      if (err && err.code === 40302) {
        wx.reLaunch({ url: '/pages/auth/invite/invite?banned=1' })
      }
      throw err
    })
  return inflight
}

/**
 * 页面 onLoad 首行调用；未登录自动跳邀请码页。
 * 隐私协议门禁在这里统一拦截：未同意协议的请求一律不发给后端，
 * 直接跳协议页 —— 各页面都走 guard()，所以这是一处全局拦截点，
 * 比逐页挂组件更可靠（不会漏掉从首页点进去的二级页面）。
 */
async function guard() {
  // 未同意隐私协议 → 拦下来，不放行任何数据请求
  if (!hasAgreed()) {
    const app = getApp()
    if (app && typeof app.ensurePrivacyAgreement === 'function') {
      app.ensurePrivacyAgreement()
    }
    return null
  }
  try {
    return await ensureLogin()
  } catch (err) {
    if (err && err.silent) return null
    throw err
  }
}

function getProfile() {
  const app = getApp()
  return app.globalData.profile
}

function getUid() {
  const p = getProfile()
  return p ? p.uid : ''
}

module.exports = { ensureLogin, guard, getProfile, getUid, clearLogin }
