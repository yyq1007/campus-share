// S1 首页：渐变页头 + 搜索 + 分类贴纸 + AI 引导卡 + 信息流
const api = require('../../utils/api')
const { guard } = require('../../utils/auth')
const { CATEGORY_STICKERS } = require('../../utils/config')

const { collectPatches, patchPost } = require('../../utils/post-sync')
const { writePatch, gcPatches } = require('../../utils/feed-patch')
const { syncTabBarLock } = require('../../utils/privacy')


Page({
  data: {
    statusBarH: 40,
    navH: 44,
    board: 'all',
    stickers: CATEGORY_STICKERS,
    digest: null,          // 最新周报（AI 引导卡下方入口），无周报时为 null
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
    // 同步 tabBar 锁定态（未同意协议时底部导航栏不可点）
    syncTabBarLock()
    const app = getApp()
    if (app.globalData.feedDirty && this.data.state !== 'loading') {
      app.globalData.feedDirty = false
      this.refresh()

    } else {
      this.applyPostPatches()

    }
  },

  // 详情页里点赞/收藏的变更补到卡片上
  applyPostPatches() {
    const { updates } = collectPatches(this.data.list, this._syncAt || 0)
    this._syncAt = Date.now()
    // 再叠加乐观补丁（点完立刻返回时请求可能还在途；它写得最晚，优先级最高）
    const patches = getApp().globalData.interactionPatches || {}
    this.data.list.forEach((item, idx) => {
      const pt = patches[item.id]
      if (pt) Object.keys(pt).forEach(k => { if (k !== 'ts') updates[`list[${idx}].${k}`] = pt[k] })
    })
    if (Object.keys(updates).length) this.setData(updates)
    gcPatches()
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
    if (reset) {
      this.setData({ cursor: null, hasMore: true, loadMoreError: false })
      this._syncAt = Date.now()
    }
    const params = { pageSize: 10, sort: 'latest' }
    if (this.data.board !== 'all') params.board = this.data.board
    if (this.data.cursor) params.cursor = this.data.cursor
    const res = await api.postList(params)
    // 首页信息流不再放周报卡（board='all' 时往期周报也会混进流里占位）：
    // 周报统一从 AI 引导卡下方的入口进，详情页内含往期周报
    const rows = (res.list || []).filter(x => !x.isDigest)
    const list = reset ? rows : this.data.list.concat(rows)
    this.setData({
      list,
      cursor: res.nextCursor,
      hasMore: res.hasMore,
      state: list.length ? 'success' : 'empty',
      digest: res.latestDigest
        ? { id: res.latestDigest.id, itemCount: res.latestDigest.itemCount || 0 }
        : (reset ? null : this.data.digest)
    })
  },

  /** AI 引导卡下方的周报入口 → 周报列表页（每期一张卡，点进去看该期精选）；
      还没生成周报时也照常进入，由列表页自己展示空态 */
  onDigestTap() {
    const d = this.data.digest
    const id = d && d.id ? `?id=${d.id}` : ''
    wx.navigateTo({ url: `/pages/digest/digest${id}` })
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
    const p = e.detail && e.detail.post
    if (!p || !p.id) return
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${p.id}` })
  },

  async onLike(e) { await this.toggleInteraction(e.detail && e.detail.post, 'like') },
  async onFav(e) { await this.toggleInteraction(e.detail && e.detail.post, 'fav') },

  async toggleInteraction(post, type) {
    if (!post || !post.id) return
    // 周报是聚合条目，不能点赞/收藏
    if (post.isDigest) return
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

    // 乐观更新，失败回滚
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
      // ⚠️ 这里不动 state：保持 'success' 才能让用户再次触底时继续重试。
      // 失败提示条做成了可点击（onLoadMoreRetry），文案与实际重试方式保持一致。
      this.setData({ loadMoreError: true })
    }
    this.setData({ loadingMore: false })
  },

  /** 点击「加载失败」提示条 → 立即重试加载下一页 */
  async onLoadMoreRetry() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true, loadMoreError: false })
    try {
      await this.fetchList(false)
    } catch (e) {
      this.setData({ loadMoreError: true })
    }
    this.setData({ loadingMore: false })
  }
})
