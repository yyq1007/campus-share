// 协议页：展示《用户协议》与《隐私政策》正文
// 由 query.type 决定展示哪一份（user / privacy）
const { USER_AGREEMENT, PRIVACY_POLICY } = require('../../utils/agreements')

const DOCS = {
  user: USER_AGREEMENT,
  privacy: PRIVACY_POLICY
}

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    title: '',
    updatedAt: '',
    blocks: []
  },

  onLoad (query) {
    // gate=1：启动拦截进入，未同意就离开本页会再次拦截
    this.gate = !!(query && query.gate)
    const doc = DOCS[(query && query.type) || 'user'] || USER_AGREEMENT
    this.setData({
      title: doc.title,
      updatedAt: doc.updatedAt,
      blocks: doc.blocks
    })
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
  },

  onBack () { wx.navigateBack() },

  onUnload () {
    if (this.gate && !this.agreed) getApp().ensurePrivacyAgreement()
  },

  /** 点击「同意并继续」：记录版本并放行被拦的隐私接口 */
  onAgree () {
    this.agreed = true
    const app = getApp()
    const granted = app && typeof app.grantPrivacyAuthorization === 'function'
      ? app.grantPrivacyAuthorization()
      : false
    if (!granted) {
      try {
        wx.setStorageSync('privacy_agreed_version', require('../../utils/agreements').PRIVACY_VERSION)
      } catch (e) { /* ignore */ }
    }
    wx.showToast({ title: '已同意', icon: 'success' })
    setTimeout(() => { wx.navigateBack() }, 800)
  }
})
