// S2 板块页：板块横幅 + 声明 + 卡片流（含"可能已过期"角标）
const api = require('../../utils/api')
const { guard } = require('../../utils/auth')
const { BOARDS } = require('../../utils/config')

const { collectPatches, patchPost } = require('../../utils/post-sync')
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
    // guard 拦截未同意隐私协议的请求
    guard()
      .then(() => this.fetchList(true))
      .catch(() => this.setData({ state: 'error' }))
  },

  onShow() {
    // 详情页里点赞/收藏的变更补到卡片上
    const { updates } = collectPatches(this.data.list, this._syncAt || 0)
    this._syncAt = Date.now()
    // 再叠加乐观补丁（点完立刻返回时请求可能还在途；补丁保留给详情页 5s 在途窗口，GC 过期清理）
    const patches = getApp().globalData.interactionPatches || {}
    this.data.list.forEach((item, idx) => {
      const pt = patches[item.id]
      if (pt) Object.keys(pt).forEach(k => { if (k !== 'ts') updates[`list[${idx}].${k}`] = pt[k] })
    })
    if (Object.keys(updates).length) this.setData(updates)
    gcPatches()
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
    const p = e.detail && e.detail.post
    if (!p || !p.id) return
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${p.id}` })
  },

  async onLike(e) { await this.toggle(e.detail.post, 'like') },
  async onFav(e) { await this.toggle(e.detail.post, 'fav') },

  async toggle(post, type) {
    // 周报是聚合条目，不能点赞/收藏
    if (!post || !post.id || post.isDigest) return
    const key = type === 'like' ? 'liked' : 'faved'
    const countKey = type === 'like' ? 'likeCount' : 'favCount'
    const idx = this.data.list.findIndex(x => x.id === post.id)
    if (idx < 0) return
    // 同一帖子同一操作还在途时忽略连点，否则后到的响应会把状态改乱
    const lock = `${post.id}:${type}`
    this._toggling = this._toggling || {}
    if (this._toggling[lock]) return
    this._toggling[lock] = true
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
      // 用服务端真值校正：列表里的状态和计数可能已过期，不校正就会和详情页对不上
      const finalActive = res && typeof res.active === 'boolean' ? res.active : active
      const finalCount = res && typeof res.count === 'number' ? res.count : nextCount
      const cur = this.data.list.findIndex(x => x.id === post.id)
      if (cur >= 0) {
        this.setData({
          [`list[${cur}].${key}`]: finalActive,
          [`list[${cur}].${countKey}`]: finalCount
        })
      }
      writePatch(post.id, { [key]: finalActive, [countKey]: finalCount })
      patchPost(post.id, { [key]: finalActive, [countKey]: finalCount })
    } catch (err) {
      const cur = this.data.list.findIndex(x => x.id === post.id)
      if (cur >= 0) {
        this.setData({
          [`list[${cur}].${key}`]: item[key],
          [`list[${cur}].${countKey}`]: item[countKey]
        })
      }
      writePatch(post.id, { [key]: item[key], [countKey]: item[countKey] })
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      this._toggling[lock] = false
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
