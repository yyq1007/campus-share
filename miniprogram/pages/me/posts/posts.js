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
    if (reset) this.setData({ cursor: null })
    // 服务端只区分 pending 与「非 deleted」；其余状态在本地按 status 过滤
    const serverTab = this.data.tab === 'pending' ? 'pending' : 'all'
    const res = await api.myPosts({
      tab: serverTab,
      pageSize: 10,
      cursor: this.data.cursor || undefined
    })
    let list = reset ? res.list : this.data.list.concat(res.list)
    // published/rejected/expired 走本地过滤；hasMore 仍以服务端分页为准
    if (this.data.tab !== 'pending' && this.data.tab !== 'all') {
      list = list.filter(p => p.status === this.data.tab)
    }
    this.setData({
      list,
      cursor: res.nextCursor,
      hasMore: res.hasMore,
      state: list.length ? 'success' : 'empty'
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
