/**
 * 登录态：无感登录（authLogin 云函数，openid 主键）+ 邀请码门禁
 * - 单飞锁：并发调用复用同一 Promise
 * - globalData.profile 缓存 5 分钟
 * 契约见 MVP 文档 9.2：needInvite=true 表示尚未绑定邀请码
 */
const api = require('./api')

let inflight = null

function clearLogin() {
  const app = getApp()
  app.globalData.profile = null
  app.globalData.profileAt = 0
  try { wx.clearStorageSync() } catch (e) { /* 忽略 */ }
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

/** 页面 onLoad 首行调用；未登录自动跳邀请码页 */
async function guard() {
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
