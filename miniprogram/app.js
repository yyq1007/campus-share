const { CLOUD_ENV, FONT_FAMILY } = require('./utils/config')

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
