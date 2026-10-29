// 我的收藏：收藏流（meList type=favorites）
const api = require('../../../utils/api')
const { guard } = require('../../../utils/auth')
const { collectPatches } = require('../../../utils/post-sync')

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    list: [],
    cursor: null,
    hasMore: true,
    state: 'loading',
    loadingMore: false
  },

  onLoad() {
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
    this.firstLoad()
  },

  async firstLoad() {
    this.setData({ state: 'loading' })
    try {
      await guard()
      await this.fetchList(true)
    } catch (e) {
      if (e && e.silent) return
      this.setData({ state: 'error' })
    }
  },

  onShow() {
    // 详情页里点赞/取消收藏的变更：取消收藏的直接移出列表
    const { updates, removedIds, deletedIds } = collectPatches(this.data.list, this._syncAt || 0)
    this._syncAt = Date.now()
    const gone = removedIds.concat(deletedIds)
    if (gone.length) {
      const list = this.data.list.filter(x => gone.indexOf(x.id) === -1)
      this.setData({ list, state: list.length ? 'success' : 'empty' })
    } else if (Object.keys(updates).length) {
      this.setData(updates)
    }
  },

  async fetchList(reset) {
    if (reset) {
      this.setData({ cursor: null })
      this._syncAt = Date.now()
    }
    const res = await api.myFavorites({
      pageSize: 10,
      cursor: this.data.cursor || undefined
    })
    const list = reset ? res.list : this.data.list.concat(res.list)
    this.setData({
      list,
      cursor: res.nextCursor,
      hasMore: res.hasMore,
      state: list.length ? 'success' : 'empty'
    })
  },

  onMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.state !== 'success') return
    this.setData({ loadingMore: true })
    this.fetchList(false)
      .catch(() => {})
      .finally(() => this.setData({ loadingMore: false }))
  },

  onPostTap(e) {
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${e.detail.post.id}` })
  },

  async onFav(e) {
    // 收藏页内取消收藏：乐观移除
    const post = e.detail.post
    const idx = this.data.list.findIndex(x => x.id === post.id)
    if (idx < 0) return
    const backup = this.data.list
    this.setData({ list: this.data.list.filter((_, i) => i !== idx) })
    try {
      await api.interactionToggle(post.id, 'fav')
    } catch (err) {
      this.setData({ list: backup })
    }
  },

  onRetry() { this.firstLoad() },

  /** 空态「去逛逛」→ 回首页看内容 */
  onEmptyAction() { wx.switchTab({ url: '/pages/index/index' }) },

  onBack() { wx.navigateBack() }
})
