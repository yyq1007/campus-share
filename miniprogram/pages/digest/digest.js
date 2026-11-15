// 周报列表：每期一张卡（日期 + 精选条数），点卡进该期精选
// 数据来源复用现有契约：postList 首屏带 latestDigest（最新一期的 id/条数），
// postDetail 对周报帖附带 pastDigests（往期 ≤10 期）→ 两者合并即完整期次列表，
// 不必为「列期次」新增云函数。
// 注意层级：本页在 pages/digest/（两层），../../ 即 miniprogram 根；
// 别再照抄 pages/post/detail/（三层）的 ../../../
const api = require('../../utils/api')
const { guard } = require('../../utils/auth')

/** 日期只留「月.日」且不补零（设计稿写法：11.2 / 11.20） */
function fmtDot(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    latest: null,  // 最新一期（本周精选）
    past: [],      // 往期周报
    state: 'loading' // loading|success|empty|error
  },

  onLoad(query) {
    // 首页周报入口会带上最新一期 id，可直接跳过一次 postList
    this.latestId = (query && query.id) || ''
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
    this.load()
  },

  async load() {
    this.setData({ state: 'loading' })
    try {
      await guard()

      let id = this.latestId
      if (!id) {
        const res = await api.postList({ board: 'life' })
        const latest = res && res.latestDigest
        id = latest && latest.id
      }
      if (!id) {
        this.setData({ latest: null, past: [], state: 'empty' })
        return
      }

      const post = await api.postDetail(id)
      const rows = [{
        id: post.id,
        publishedAt: post.publishedAt,
        itemCount: post.itemCount || (post.digestItems || []).length
      }].concat(post.pastDigests || [])

      // 去重（本期可能同时出现在 pastDigests 边界上）+ 按发布时间倒序
      const seen = {}
      const list = rows
        .filter(r => r && r.id && !seen[r.id] && (seen[r.id] = 1))
        .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
        .map(r => ({ id: r.id, dateDot: fmtDot(r.publishedAt), itemCount: r.itemCount || 0 }))

      this.setData({ latest: list[0] || null, past: list.slice(1), state: list.length ? 'success' : 'empty' })
    } catch (e) {
      if (e && e.silent) return
      this.setData({ state: 'error' })
    }
  },

  onIssueTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${id}` })
  },

  onRetry() {
    this.load()
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    })
  },

  onShareAppMessage() {
    return { title: '校园周报 · 一周好帖都在这', path: '/pages/digest/digest' }
  }
})
