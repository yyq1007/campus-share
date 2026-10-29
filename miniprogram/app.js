const { CLOUD_ENV, FONT_FAMILY } = require('./utils/config')
const { PRIVACY_VERSION, hasAgreed, markAgreed } = require('./utils/privacy')

// 标题圆体：base64 Data URL（wx.loadFontFace 的 source 仅支持 https 或 Data URL，
// 包内路径不被支持、云端 URL 被 CORS 挡——见 tools/build-font-data.js）
const FONT_DATA_URL = require('./utils/font-data')

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
  },

  onHide() {
    this.__hidden = true
  },

  /**
   * 隐私协议授权入口。
   * 微信在用户触发隐私接口（如 chooseMedia）且此前未同意时回调此钩子，
   * 开发者需引导用户阅读协议并再次授权。
   * 协议正文页：pages/agreement/agreement?type=both
   *
   * ⚠️ 关于「暂不」：这里不能 resolve({event:'disagree'})。
   * 微信收到 disagree 会判定用户拒绝隐私协议并中断接口调用，
   * 但表现不稳定（部分基础库会直接关小程序）。
   * 我们改为统一走 exitMiniProgram() 主动关闭，行为可控。
   */
  onNeedPrivacyAuthorization(resolve) {
    this.__privacyResolve = resolve
    const goAgreement = () => {
      wx.navigateTo({
        url: '/pages/agreement/agreement?type=both',
        fail: () => { this.__privacyReject() }
      })
    }
    wx.showModal({
      title: '隐私保护指引',
      content: '发布内容需要使用你的相册/相机，并会在云端保存用于展示。请阅读并同意《用户协议》与《隐私政策》后继续。',
      confirmText: '去阅读',
      cancelText: '暂不',
      success: (r) => {
        if (r.confirm) {
          goAgreement()
        } else {
          // 暂不 = 不同意 → 直接关闭小程序，不放行任何内容
          this.__privacyReject()
        }
      },
      // 弹窗本身失败（如页面栈异常）时，直接带去协议页，避免流程卡死
      fail: () => { goAgreement() }
    })
  },

  /** 用户在协议页点了「同意」后调用：放行本次隐私接口并记住版本 */
  grantPrivacyAuthorization() {
    markAgreed()
    const resolve = this.__privacyResolve
    this.__privacyResolve = null
    if (typeof resolve === 'function') {
      resolve({ buttonId: 'agree', event: 'agree' })
      return true
    }
    return false
  },

  /**
   * 用户点「拒绝」/「暂不」：不等同意，关闭小程序。
   * 不调 resolve({event:'disagree'}) —— 那个会让微信自行中断并可能误关，
   * 这里统一由 exitMiniProgram 控制退出行为。
   */
  __privacyReject() {
    this.__privacyResolve = null
    wx.exitMiniProgram({
      complete: () => {
        // 真机上小程序已关闭，onHide 会置 __hidden=true；
        // 开发者工具里 exitMiniProgram 不会真的退出（只走 complete 不触发 onHide），
        // 这时给一句反馈，否则用户点了像没反应。
        setTimeout(() => {
          if (!this.__hidden) {
            wx.showToast({ title: '需同意协议后才能使用', icon: 'none' })
          }
        }, 300)
      }
    })
  },

  /**
   * 是否已同意当前版本协议。
   * 首启同意由页面级组件 privacy-gate 承担（onLaunch 阶段页面尚未创建，
   * 页面级 API 在那里调用会静默失败），此方法仅供各页查询。
   */
  hasPrivacyAgreement () {
    return hasAgreed()
  },

  /**
   * 兜底拦截：正常流程由 privacy-gate 组件负责（首页与邀请码页都挂了组件）。
   * 这里只兜住「组件没挂上的页面」——例如协议页返回时不该放行。
   *
   * ⚠️ 组件已在页面上时（privacyGateActive）不再弹 modal，
   * 否则会和组件的全屏遮罩双重弹窗。
   */
  ensurePrivacyAgreement() {
    if (hasAgreed() || this.__gateShowing) return
    // 组件正在接管（页面上有全屏遮罩）→ 由组件负责交互，这里不重复弹
    if (this.privacyGateActive) return
    this.__gateShowing = true

    setTimeout(() => {
      wx.showModal({
        title: '欢迎来到好物分享',
        content: '开始使用前请阅读并同意《用户协议》与《隐私政策》。不同意将无法使用本小程序。',
        confirmText: '去阅读',
        cancelText: '暂不',
        success: (r) => {
          if (r.confirm) {
            wx.navigateTo({
              url: '/pages/agreement/agreement?type=both&gate=1',
              success: () => { this.__gateShowing = false },
              fail: () => { this.__regate() }
            })
          } else {
            // 暂不 = 不同意 → 关闭小程序
            this.__privacyReject()
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
