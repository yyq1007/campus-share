// S2 板块页：板块横幅 + 声明 + 卡片流（含"可能已过期"角标）
const api = require('../../utils/api')
const { guard } = require('../../utils/auth')
const { BOARDS } = require('../../utils/config')
const { collectPatches } = require('../../utils/post-sync')

Page({
  data: {
    board: '',
    meta: null,
    list: [],
    cursor: null,
    hasMore: true,
    total: 0,
    state: 'loading',
    loadingMore: false,
    invalidBoard: false
  },

  onLoad(options) {
    const board = options.board || ''
    if (!BOARDS[board]) {
      this.setData({ invalidBoard: true, state: 'none' })
      return
    }
    this.setData({ board, meta: BOARDS[board] })
    // guard 拦截未同意隐私协议的请求
    guard()
      .then(() => this.fetchList(true))
      .catch(() => this.setData({ state: 'error' }))
  },

  onShow() {
    // 详情页里点赞/收藏的变更补到卡片上
    const { updates } = collectPatches(this.data.list, this._syncAt || 0)
    this._syncAt = Date.now()
    if (Object.keys(updates).length) this.setData(updates)
  },

  async fetchList(reset) {
    if (reset) {
      this.setData({ cursor: null, hasMore: true, list: [], state: 'loading' })
      this._syncAt = Date.now()
    }
    const params = { board: this.data.board, pageSize: 10, sort: 'latest' }
    if (this.data.cursor) params.cursor = this.data.cursor
    const res = await api.postList(params)
    const list = reset ? res.list : this.data.list.concat(res.list)
    this.setData({
      list,
      cursor: res.nextCursor,
      hasMore: res.hasMore,
      total: res.total || list.length,
      state: list.length ? 'success' : 'empty'
    })
  },

  onPostTap(e) {
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${e.detail.post.id}` })
  },

  async onLike(e) { await this.toggle(e.detail.post, 'like') },
  async onFav(e) { await this.toggle(e.detail.post, 'fav') },

  async toggle(post, type) {
    const key = type === 'like' ? 'liked' : 'faved'
    const countKey = type === 'like' ? 'likeCount' : 'favCount'
    const idx = this.data.list.findIndex(x => x.id === post.id)
    if (idx < 0) return
    const item = this.data.list[idx]
    const active = !item[key]
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
    wx.navigateTo({ url: `/pages/post/create/create?board=${this.data.board}` })
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  },

  onRetry() { this.fetchList(true).catch(() => this.setData({ state: 'error' })) },

  async onPullDownRefresh() {
    if (this.data.board) {
      try { await this.fetchList(true) } catch (e) { /* 保底 */ }
    }
    wx.stopPullDownRefresh()
  },

  async onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.state !== 'success') return
    this.setData({ loadingMore: true })
    try { await this.fetchList(false) } catch (e) { /* 保底 */ }
    this.setData({ loadingMore: false })
  }
})
