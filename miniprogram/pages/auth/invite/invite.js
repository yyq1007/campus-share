// 邀请码页：校内准入验证（不获取任何微信用户信息，仅校验邀请码）
// 规格 6.10：自动大写、过滤非字母数字；6-16 位（兼容 CAMPUS2026 这类 10 位站点码）；错误抖动 + 红字原因；scene 带入自动提交
const api = require('../../../utils/api')
const { toast } = require('../../../utils/cloud')

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    code: '',
    error: '',
    shake: false,
    submitting: false
  },

  onLoad(options) {
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }

    // 三种带入：query.invite / query.code / 小程序码 scene=i:XXXX
    let code = ''
    try {
      if (options && options.scene) {
        const scene = decodeURIComponent(options.scene)
        code = (scene.startsWith('i:') ? scene.slice(2) : scene).toUpperCase()
      } else if (options && (options.invite || options.code)) {
        code = String(options.invite || options.code).toUpperCase()
      }
    } catch (e) { /* 忽略 */ }

    if (code) {
      this.setData({ code: code.replace(/[^A-Z0-9]/g, '') })
      this.onSubmit() // 带入时自动提交
    }
  },

  onInput(e) {
    // 自动大写 + 过滤非字母数字
    this.setData({
      code: String(e.detail.value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
      error: ''
    })
  },

  showError(msg) {
    this.setData({ error: msg, shake: true })
    setTimeout(() => this.setData({ shake: false }), 500)
  },

  async onSubmit() {
    const code = this.data.code.trim()
    if (this.data.submitting) return
    if (!code) return this.showError('请输入邀请码')
    if (code.length < 6 || code.length > 16) return this.showError('邀请码为 6-16 位字母或数字')
    this.setData({ submitting: true, error: '' })
    try {
      await api.bindInvite(code)
      toast('欢迎加入！')
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index' })
      }, 900)
    } catch (e) {
      this.showError((e && e.msg) || '邀请码无效')
    } finally {
      this.setData({ submitting: false })
    }
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  }
})
