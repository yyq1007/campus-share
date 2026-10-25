// S1 首页：渐变页头 + 搜索 + 分类贴纸 + AI 引导卡 + 信息流
const api = require('../../utils/api')
const { guard } = require('../../utils/auth')
const { CATEGORY_STICKERS } = require('../../utils/config')

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    board: 'all',
    stickers: CATEGORY_STICKERS,
    list: [],
    cursor: null,
    hasMore: true,
    state: 'loading',      // loading|success|empty|error
    loadingMore: false,
    loadMoreError: false
  },

  onLoad() {
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 默认值兜底 */ }
    this.firstLoad()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    const app = getApp()
    if (app.globalData.feedDirty && this.data.state !== 'loading') {
      app.globalData.feedDirty = false
      this.refresh()
    }
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

  async refresh() {
    try {
      await this.fetchList(true)
    } catch (e) { /* 保底 */ }
  },

  async fetchList(reset) {
    if (reset) this.setData({ cursor: null, hasMore: true, loadMoreError: false })
    const params = { pageSize: 10, sort: 'latest' }
    if (this.data.board !== 'all') params.board = this.data.board
    if (this.data.cursor) params.cursor = this.data.cursor
    const res = await api.postList(params)
    const list = reset ? res.list : this.data.list.concat(res.list)
    this.setData({
      list,
      cursor: res.nextCursor,
      hasMore: res.hasMore,
      state: list.length ? 'success' : 'empty'
    })
  },

  onStickerTap(e) {
    const key = e.currentTarget.dataset.board
    wx.navigateTo({ url: `/pages/board/board?board=${key}&from=index` })
  },

  onSearchTap() {
    wx.navigateTo({ url: '/pages/search/search?from=home' })
  },

  onAiTap() {
    const app = getApp()
    app.globalData.focusAskInput = true
    wx.switchTab({ url: '/pages/ask/ask' })
  },

  onPostTap(e) {
    const p = e.detail.post
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${p.id}` })
  },

  async onLike(e) { await this.toggleInteraction(e.detail.post, 'like') },
  async onFav(e) { await this.toggleInteraction(e.detail.post, 'fav') },

  async toggleInteraction(post, type) {
    const key = type === 'like' ? 'liked' : 'faved'
    const countKey = type === 'like' ? 'likeCount' : 'favCount'
    const idx = this.data.list.findIndex(x => x.id === post.id)
    if (idx < 0) return
    const item = this.data.list[idx]
    const active = !item[key]
    // 乐观更新，失败回滚
    this.setData({
      [`list[${idx}].${key}`]: active,
      [`list[${idx}].${countKey}`]: Math.max(0, (item[countKey] || 0) + (active ? 1 : -1))
    })
    if (active) wx.vibrateShort({ type: 'light' })
    try {
      await api.interactionToggle(post.id, type)
    } catch (err) {
      this.setData({
        [`list[${idx}].${key}`]: item[key],
        [`list[${idx}].${countKey}`]: item[countKey]
      })
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  onFab() {
    const board = this.data.board === 'all' ? 'life' : this.data.board
    wx.navigateTo({ url: `/pages/post/create/create?board=${board}` })
  },

  onRetry() { this.firstLoad() },
  onEmptyAction() { this.onFab() },

  async onPullDownRefresh() {
    try { await this.fetchList(true) } catch (e) { /* 保底 */ }
    wx.stopPullDownRefresh()
  },

  async onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.state !== 'success') return
    this.setData({ loadingMore: true, loadMoreError: false })
    try {
      await this.fetchList(false)
    } catch (e) {
      this.setData({ loadMoreError: true })
    }
    this.setData({ loadingMore: false })
  }
})
