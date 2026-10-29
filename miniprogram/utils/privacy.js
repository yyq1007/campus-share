// 隐私协议同意状态：读写本地缓存 + 供页面/组件统一判断
// 版本号需与 utils/agreements.js 的 PRIVACY_VERSION 一致。
// 与云函数 authLogin 写入 users.privacyVersion 保持同一版本语义。

const { PRIVACY_VERSION } = require('./agreements')

const AGREE_KEY = 'privacy_agreed_version'

/** 是否已同意当前版本的协议 */
function hasAgreed () {
  try {
    return wx.getStorageSync(AGREE_KEY) === PRIVACY_VERSION
  } catch (e) {
    return false
  }
}

/** 记录已同意（版本升级后需要重新同意） */
function markAgreed () {
  try {
    wx.setStorageSync(AGREE_KEY, PRIVACY_VERSION)
    return true
  } catch (e) {
    return false
  }
}

/**
 * 退出登录时 wx.clearStorageSync() 会把同意标记一起清掉，
 * 造成用户只是登出就被迫重新弹协议。这里先存后恢复。
 */
function preserveAcrossClear () {
  let saved = ''
  try {
    saved = wx.getStorageSync(AGREE_KEY) || ''
  } catch (e) { /* ignore */ }
  return {
    restore () {
      if (!saved) return
      try { wx.setStorageSync(AGREE_KEY, saved) } catch (e) { /* ignore */ }
    }
  }
}

/**
 * 同步 custom-tab-bar 的锁定状态。
 * custom-tab-bar 由框架渲染在页面内容层之上，页面内的 privacy-gate 遮罩盖不住它，
 * 所以它自己维护 locked 状态。
 *
 * @param {boolean} [all] true = 同步页面栈里所有 tab 页（同意/拒绝后用）；
 *                        不传 = 只同步当前页（tab 页 onShow 里用）。
 */
function syncTabBarLock (all) {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    const targets = all ? pages : [pages[pages.length - 1]]
    targets.forEach(p => {
      if (!p || typeof p.getTabBar !== 'function') return
      const tb = p.getTabBar()
      if (tb && typeof tb.syncLock === 'function') tb.syncLock()
    })
  } catch (e) { /* ignore */ }
}

module.exports = {
  AGREE_KEY,
  PRIVACY_VERSION,
  hasAgreed,
  markAgreed,
  preserveAcrossClear,
  syncTabBarLock
}
