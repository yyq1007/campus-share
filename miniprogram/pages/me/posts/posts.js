// 我的分享：状态筛选
// 契约边界：meList 服务端只支持 pending / 非 deleted 两种过滤，
// 其余状态在本地按 status 过滤（hasMore 以服务端为准）
const api = require('../../../utils/api')
const { toast } = require('../../../utils/cloud')
const { guard } = require('../../../utils/auth')

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '审核中' },
  { key: 'published', label: '已发布' },
  { key: 'rejected', label: '已驳回' },
  { key: 'expired', label: '已过期' }
]

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    tabs: TABS,
    tab: 'all',
    list: [],
    cursor: null,
    hasMore: true,
    state: 'loading',
    loadingMore: false
  },

  onLoad(query) {
    const tab = TABS.some(t => t.key === query.tab) ? query.tab : 'all'
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height, tab })
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

  async fetchList(reset) {
    // 请求序号：快速切 tab 会并发多个请求，只有最后一次的结果才该落地，
    // 否则先发的请求后到 → 用旧 tab 的数据覆盖当前 tab（列表与 tab 不一致）
    this._reqSeq = (this._reqSeq || 0) + 1
    const seq = this._reqSeq

    if (reset) this.setData({ cursor: null, list: [] })
    // 服务端只区分 pending 与「非 deleted」；其余状态在本地按 status 过滤
    const needFilter = this.data.tab !== 'pending' && this.data.tab !== 'all'
    const serverTab = this.data.tab === 'pending' ? 'pending' : 'all'

    let matched = reset ? [] : (this.data.list || []).slice()
    let cursor = this.data.cursor || undefined
    let hasMore = true
    let rounds = 0

    // ⚠️ 本地过滤可能整页都匹配不上（服务端并不按这些状态分页）。
    //    若此时直接置空态，wxml 的 wx:if 会把 scroll-view 整个换掉 →
    //    bindscrolltolower 永不触发 → 后续分页里的匹配帖永远翻不到。
    //    所以：一页没匹配上但服务端还有数据时，自动继续翻页去找。
    while (rounds < 20) {
      rounds += 1
      const res = await api.myPosts({
        tab: serverTab,
        pageSize: 10,
        cursor
      })
      // 请求已过期（用户又切了 tab）→ 丢弃这次结果
      if (seq !== this._reqSeq) return
      let batch = res.list || []
      if (needFilter) batch = batch.filter(p => p.status === this.data.tab)
      matched = matched.concat(batch)
      cursor = res.nextCursor
      hasMore = res.hasMore
      if (matched.length || !hasMore) break
      // 一页没匹配上，但服务端还有更多 → 继续翻下一页
    }

    if (seq !== this._reqSeq) return
    this.setData({
      list: matched,
      cursor,
      hasMore,
      state: matched.length ? 'success' : 'empty'
    })
  },

  async onMore() {
    if (!this.data.hasMore || this.data.loadingMore) return
    this.setData({ loadingMore: true })
    try {
      await this.fetchList(false)
    } catch (e) {
      toast('加载失败')
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.key
    if (tab === this.data.tab) return
    this.setData({ tab, list: [], state: 'loading' })
    this.fetchList(true).catch(() => this.setData({ state: 'error' }))
  },

  onPostTap(e) {
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${e.detail.post.id}` })
  },

  async onDelete(e) {
    const id = e.detail.post.id
    const confirmed = await new Promise(resolve => {
      wx.showModal({
        title: '删除分享',
        content: '删除后不可恢复，确定吗？',
        success: res => resolve(res.confirm)
      })
    })
    if (!confirmed) return
    try {
      await api.postDelete(id)
      toast('已删除')
      this.fetchList(true)
      getApp().globalData.feedDirty = true
    } catch (err) {
      toast((err && err.msg) || '删除失败')
    }
  },

  onFab() {
    wx.navigateTo({ url: '/pages/post/create/create?board=life' })
  },
  onRetry() { this.firstLoad() },
  onEmptyAction() { this.onFab() },
  onBack() { wx.navigateBack() }
})
