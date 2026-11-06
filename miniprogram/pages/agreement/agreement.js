// 协议页：展示《用户协议》与《隐私政策》正文
// query.type: user（用户协议）/ privacy（隐私政策）/ both（两份都展示，首启同意用）
// query.gate=1：从门禁拦截进入，未同意就离开本页会再次拦截
const { USER_AGREEMENT, PRIVACY_POLICY } = require('../../utils/agreements')
const { markAgreed } = require('../../utils/privacy')

const DOCS = {
  user: USER_AGREEMENT,
  privacy: PRIVACY_POLICY
}

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    title: '',
    sections: []
  },

  onLoad (query) {
    // gate=1：门禁拦截进入，未同意就离开本页会再次拦截
    this.gate = !!(query && query.gate)

    const type = (query && query.type) || 'user'
    let sections = []
    let title = ''
    if (type === 'both') {
      sections = [USER_AGREEMENT, PRIVACY_POLICY]
      title = '用户协议与隐私政策'
    } else {
      const doc = DOCS[type] || USER_AGREEMENT
      sections = [doc]
      title = doc.title
    }
    this.setData({
      title,
      sections: sections.map(d => ({ title: d.title, updatedAt: d.updatedAt, blocks: d.blocks }))
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
    // 未同意就离开协议页 → 重新拉起门禁（不让人绕过）
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
      // 没有待放行的隐私接口（如首启同意场景），仍要落库同意标记并广播
      markAgreed()
      if (app && typeof app.emitPrivacyStateChanged === 'function') {
        app.emitPrivacyStateChanged()
      }
    }
    wx.showToast({ title: '已同意', icon: 'success' })
    setTimeout(() => { wx.navigateBack() }, 800)
  }
})
