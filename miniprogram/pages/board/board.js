// S2 板块页：板块横幅 + 声明 + 卡片流（含"可能已过期"角标）
const api = require('../../utils/api')
const { BOARDS } = require('../../utils/config')
const { writePatch, gcPatches } = require('../../utils/feed-patch')

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
    this.fetchList(true).catch(() => this.setData({ state: 'error' }))
  },

  onShow() {
    // 同步详情页带回的点赞/收藏变更：局部 patch 对应卡片（补丁保留给详情页 5s 在途窗口，GC 过期清理）
    const patches = getApp().globalData.interactionPatches
    if (patches && Object.keys(patches).length) {
      const updates = {}
      this.data.list.forEach((item, idx) => {
        const pt = patches[item.id]
        if (pt) Object.keys(pt).forEach(k => { if (k !== 'ts') updates[`list[${idx}].${k}`] = pt[k] })
      })
      if (Object.keys(updates).length) this.setData(updates)
      gcPatches()
    }
  },

  async fetchList(reset) {
    if (reset) this.setData({ cursor: null, hasMore: true, list: [], state: 'loading' })
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
    const nextCount = Math.max(0, (item[countKey] || 0) + (active ? 1 : -1))
    this.setData({
      [`list[${idx}].${key}`]: active,
      [`list[${idx}].${countKey}`]: nextCount
    })
    writePatch(post.id, { [key]: active, [countKey]: nextCount })
    if (active) wx.vibrateShort({ type: 'light' })
    try {
      const res = await api.interactionToggle(post.id, type)
      if (res && typeof res.count === 'number' && res.count !== nextCount) {
        this.setData({ [`list[${idx}].${countKey}`]: res.count })
        writePatch(post.id, { [key]: !!res.active, [countKey]: res.count })
      }
    } catch (err) {
      this.setData({
        [`list[${idx}].${key}`]: item[key],
        [`list[${idx}].${countKey}`]: item[countKey]
      })
      writePatch(post.id, { [key]: item[key], [countKey]: item[countKey] })
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
