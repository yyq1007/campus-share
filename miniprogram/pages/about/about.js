// 关于页：产品说明 + 社区守则 + 版本
const { VERSION } = require('../../utils/config')

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    version: VERSION,
    rules: [
      '仅限本校同学分享真实好物、学习资料与美食体验',
      '禁止发布广告、刷单、代购拉群等营销内容',
      '禁止发布违法违规、低俗辱骂、泄露他人隐私的内容',
      '分享需为原创或已获授权，尊重他人知识产权',
      '所有内容经审核后展示，违规内容将被驳回或下线'
    ]
  },

  onLoad() {
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
  },

  onBack() { wx.navigateBack() }
})
