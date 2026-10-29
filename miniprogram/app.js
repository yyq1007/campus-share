const { CLOUD_ENV, FONT_FAMILY } = require('./utils/config')
const { PRIVACY_VERSION, hasAgreed, markAgreed, syncTabBarLock } = require('./utils/privacy')

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

    this.installNavGuard()
  },

  /**
   * 全局导航拦截：未同意隐私协议时，所有页面跳转一律拦住。
   *
   * 为什么需要这一层：
   *   1) custom-tab-bar 由框架渲染在页面内容层之上，页面内的 privacy-gate 遮罩盖不住它；
   *   2) 导航入口散落在 40+ 处（首页贴纸、搜索、帖子卡、tabBar…），
   *      逐个加判断容易漏；拦截器是一处兜住全部。
   *
   * 放行的目标：协议页（要看正文）、邀请码页（要用邀请码进）、
   * 关于页（协议入口）、首页自身。
   */
  installNavGuard() {
    if (typeof wx.addInterceptor !== 'function') return
    const ALLOW = [
      '/pages/agreement/agreement',
      '/pages/about/about',
      '/pages/auth/invite/invite'
    ]
    const allow = (url) => {
      if (!url) return false
      const path = String(url).split('?')[0]
      if (path === '/pages/index/index') return true
      return ALLOW.some(p => path === p)
    }
    const apis = ['navigateTo', 'redirectTo', 'switchTab', 'reLaunch']
    apis.forEach(api => {
      try {
        wx.addInterceptor({
          api,
          invoke (args) {
            if (hasAgreed() || allow(args && args.url)) return args
            // 拦住：提示 + 拉起门禁，不执行原始跳转
            wx.showToast({ title: '请先同意协议', icon: 'none' })
            const app = getApp()
            if (app && typeof app.ensurePrivacyAgreement === 'function') {
              app.ensurePrivacyAgreement()
            }
            throw new Error('privacy-not-agreed')
          }
        })
      } catch (e) { /* 单个 API 拦截失败不影响其它 */ }
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
    this.emitPrivacyStateChanged()
    if (typeof resolve === 'function') {
      resolve({ buttonId: 'agree', event: 'agree' })
      return true
    }
    return false
  },

  /**
   * 门禁组件挂载计数：多个页面各挂一个 privacy-gate，
   * 用计数而不是布尔值，否则返回上一页时旧组件 detached 会误清标记。
   */
  acquirePrivacyGate() {
    this.__gateCount = (this.__gateCount || 0) + 1
    this.privacyGateActive = true
  },

  releasePrivacyGate() {
    this.__gateCount = Math.max(0, (this.__gateCount || 0) - 1)
    this.privacyGateActive = this.__gateCount > 0
  },

  /**
   * 同步各 tab 页的 TabBar 锁定状态。
   * custom-tab-bar 由框架渲染在页面内容层之上，页面内的 privacy-gate 遮罩盖不住它，
   * 所以它自己维护一份 locked 状态 —— 同意/拒绝后需要主动通知它刷新。
   */
  syncTabBarLock() {
    syncTabBarLock(true)
  },

  /**
   * 门禁状态广播：同意/拒绝后通知所有已挂载的 privacy-gate 组件刷新遮罩。
   * 页面栈里可能同时存在多个 gate 实例（每个页面各挂一个），
   * getCurrentPages 拿不到组件实例，所以走 App 层订阅表。
   */
  onPrivacyStateChanged(fn) {
    if (typeof fn !== 'function') return () => {}
    if (!this.__privacyListeners) this.__privacyListeners = []
    this.__privacyListeners.push(fn)
    return () => {
      this.__privacyListeners = (this.__privacyListeners || []).filter(x => x !== fn)
    }
  },

  emitPrivacyStateChanged() {
    ;(this.__privacyListeners || []).forEach(fn => {
      try { fn() } catch (e) { /* 单个监听失败不影响其它 */ }
    })
    this.syncTabBarLock()
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
