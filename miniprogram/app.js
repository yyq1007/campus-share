const { CLOUD_ENV, FONT_FAMILY } = require('./utils/config')
const { PRIVACY_VERSION } = require('./utils/agreements')

// 标题圆体：base64 Data URL（wx.loadFontFace 的 source 仅支持 https 或 Data URL，
// 包内路径不被支持、云端 URL 被 CORS 挡——见 tools/build-font-data.js）
const FONT_DATA_URL = require('./utils/font-data')

// 隐私协议同意状态的本地缓存键
const PRIVACY_AGREE_KEY = 'privacy_agreed_version'

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库版本过低（需 2.2.3+）')
      return
    }
    wx.cloud.init({
      env: CLOUD_ENV,
      traceUser: true
    })
    this.loadTitleFont()

    // 网络状态监听：离线提示条由各页消费
    wx.onNetworkStatusChange(res => {
      this.globalData.network = res.isConnected ? 'online' : 'offline'
    })

  },

  onShow() {
    this.__hidden = false
    // 未同意协议不允许使用：每次回到前台都检查（onShow 在启动时也会触发）
    this.ensurePrivacyAgreement()
  },

  onHide() {
    this.__hidden = true
  },

  /**
   * 隐私协议授权入口。
   * 微信在用户触发隐私接口（如 chooseMedia）且此前未同意时回调此钩子，
   * 开发者需引导用户阅读协议并再次授权。
   * 协议正文页：pages/agreement/agreement?type=privacy
   */
  onNeedPrivacyAuthorization(resolve) {
    this.__privacyResolve = resolve
    const goAgreement = () => {
      wx.navigateTo({
        url: '/pages/agreement/agreement?type=privacy',
        fail: () => { this.__privacyFallback() }
      })
    }
    wx.showModal({
      title: '隐私保护指引',
      content: '发布内容需要使用你的相册/相机，并会在云端保存用于展示。请阅读并同意《隐私政策》后继续。',
      confirmText: '去阅读',
      cancelText: '暂不',
      success: (r) => {
        if (r.confirm) {
          goAgreement()
        } else {
          this.__privacyFallback()
        }
      },
      fail: () => { this.__privacyFallback() }
    })
  },

  /** 用户在协议页点了「同意」后调用：放行本次隐私接口并记住版本 */
  grantPrivacyAuthorization() {
    try {
      wx.setStorageSync(PRIVACY_AGREE_KEY, PRIVACY_VERSION)
    } catch (e) { /* ignore */ }
    const resolve = this.__privacyResolve
    this.__privacyResolve = null
    if (typeof resolve === 'function') {
      resolve({ buttonId: 'agree', event: 'agree' })
      return true
    }
    return false
  },

  /** 用户拒绝时的兜底：按「不同意」处理，微信侧会中断本次隐私接口调用 */
  __privacyFallback() {
    const resolve = this.__privacyResolve
    this.__privacyResolve = null
    if (typeof resolve === 'function') {
      resolve({ event: 'disagree' })
    }
  },

  hasAgreedPrivacy() {
    try {
      return wx.getStorageSync(PRIVACY_AGREE_KEY) === PRIVACY_VERSION
    } catch (e) {
      return false
    }
  },

  /**
   * 检查是否已同意当前版本协议，未同意则弹窗拦截：
   * - 去阅读 → 协议页（gate 模式：不同意就返回会再次拦截）
   * - 暂不 → 退出小程序；退出失败（开发者工具/低版本）则继续弹窗，不放行使用
   */
  ensurePrivacyAgreement() {
    if (this.hasAgreedPrivacy() || this.__gateShowing) return
    this.__gateShowing = true

    // 延后一点，等首页渲染完成再弹，避免与页面初始化抢资源
    setTimeout(() => {
      wx.showModal({
        title: '欢迎来到好物分享',
        content: '开始使用前请阅读并同意《用户协议》与《隐私政策》。不同意将无法使用本小程序。',
        confirmText: '去阅读',
        cancelText: '暂不',
        success: (r) => {
          if (r.confirm) {
            wx.navigateTo({
              url: '/pages/agreement/agreement?type=user&gate=1',
              success: () => { this.__gateShowing = false },
              fail: () => { this.__regate() }
            })
          } else {
            // 开发者工具里 exitMiniProgram 会走 success 但不真正退出，所以不论结果都重新拦截；
            // 真机已退到后台时 __regate 只复位，等下次 onShow 再拦
            wx.exitMiniProgram({ complete: () => { this.__regate() } })
          }
        },
        fail: () => { this.__regate() }
      })
    }, 800)
  },

  /** 重新弹出协议拦截 */
  __regate() {
    this.__gateShowing = false
    if (this.__hidden) return
    this.ensurePrivacyAgreement()
  },

  /** 圆体标题字：Data URL 直载（零网络零 CORS），失败降级系统 600（不允许布局跳动，标题行高已固定） */
  loadTitleFont() {
    if (!FONT_DATA_URL) return
    wx.loadFontFace({
      family: FONT_FAMILY,
      source: `url("${FONT_DATA_URL}")`,
      global: true,
      scopes: ['webview', 'native'],
      timeout: 2000,
      success: () => { this.globalData.fontLoaded = true },
      fail: () => { this.globalData.fontLoaded = false }
    })
  },

  onError(err) {
    console.error('[app.onError]', err)
    // 异常上报（失败静默，绝不弹窗阻塞用户）
    try {
      wx.cloud.callFunction({
        name: 'clientLog',
        data: { type: 'error', message: (err && err.message) || String(err), stack: (err && err.stack) || '' }
      })
    } catch (e) { /* ignore */ }
  },

  onUnhandledRejection(reason) {
    try {
      wx.cloud.callFunction({
        name: 'clientLog',
        data: { type: 'rejection', message: (reason && reason.message) || String(reason) }
      })
    } catch (e) { /* ignore */ }
  },

  globalData: {
    profile: null,        // { uid, role, status, stats, unread, ... }
    profileAt: 0,
    feedDirty: false,     // 发帖/删除后置 true，首页 onShow 刷新
    focusAskInput: false, // 切到问答 tab 后自动聚焦
    pendingAsk: null,     // 跨页带入的提问 { q }
    fontLoaded: false,
    network: 'online'
  }
})
