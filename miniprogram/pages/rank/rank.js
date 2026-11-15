// S10 榜单：热度榜（长期累计赞藏）/ 新秀榜（近 7 天热度）/ 板块筛选
// 数据来自 rankList 云函数（读 posts 索引排序，非快照）；榜长 50，前端不分页
const api = require('../../utils/api')
const { guard } = require('../../utils/auth')
const { syncTabBarLock } = require('../../utils/privacy')

// 板块展示顺序：全部 / 美食 / 生活 / 学习（key 与 utils/config.js 的 BOARDS 一致）
const BOARDS = [
  { key: 'all', label: '全部' },
  { key: 'food', label: '美食' },
  { key: 'life', label: '生活' },
  { key: 'study', label: '学习' }
]

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    tab: 'hot',            // hot | fresh
    board: 'all',
    boards: BOARDS,
    list: [],
    state: 'loading',      // loading | success | empty | error
    updatedText: ''
  },

  onLoad() {
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
  },

  onShow() {
    const app = getApp()
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    // 5 位置 TabBar：首页0 / 问答1 / 发布2 / 榜单3 / 我的4
    if (tabBar) tabBar.setData({ selected: 3, unread: app.globalData.unread || 0 })
    // 同步 tabBar 锁定态（未同意协议时底部导航栏不可点）
    syncTabBarLock()
    // 榜单变化慢：3 分钟内切回不重复请求，超过则静默刷新（首次进入必拉）
    if (!this._loadedAt || Date.now() - this._loadedAt > 3 * 60 * 1000) this.load()
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab, list: [], state: 'loading' }, () => this.load())
  },

  onBoardTap(e) {
    const board = e.currentTarget.dataset.board
    if (board === this.data.board) return
    this.setData({ board, list: [], state: 'loading' }, () => this.load())
  },

  async load() {
    // 请求序号防竞态：快速切 Tab / 切板块时只认最后一次的结果
    this.seq = (this.seq || 0) + 1
    const my = this.seq
    try {
      await guard()
      const type = this.data.tab === 'fresh'
        ? 'fresh'
        : (this.data.board === 'all' ? 'hot' : 'board')
      const res = await api.rankList({
        type,
        board: type === 'board' ? this.data.board : ''
      })
      if (my !== this.seq) return
      const list = res.list || []
      this._loadedAt = Date.now()
      this.setData({
        list,
        state: list.length ? 'success' : 'empty',
        updatedText: res.updatedAt ? this.fmtTime(res.updatedAt) : ''
      })
    } catch (e) {
      if (my !== this.seq) return
      this.setData({ state: 'error' })
    }
  },

  fmtTime(ts) {
    const d = new Date(ts)
    const p = n => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())} 更新`
  },

  onRetry() {
    this.setData({ state: 'loading' }, () => this.load())
  },

  onPostTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${id}` })
  }
})
