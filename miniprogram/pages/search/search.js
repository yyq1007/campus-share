// 搜索页：热词 + 搜索历史 + 结果流（postList 关键字模式）
const api = require('../../utils/api')
const { toast } = require('../../utils/cloud')
const { guard } = require('../../utils/auth')

const HISTORY_KEY = 'search_history'

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    keyword: '',
    searching: false,
    list: [],
    cursor: null,
    hasMore: true,
    state: 'idle',       // idle|loading|success|empty|error
    history: [],
    hotWords: ['食堂', '好物', '资料', '平价', '宿舍']
  },

  onLoad(query) {
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
    this.setData({ history: this.readHistory() })
    if (query.kw) {
      this.setData({ keyword: query.kw })
      this.search(query.kw)
    }
  },

  readHistory() {
    try { return wx.getStorageSync(HISTORY_KEY) || [] } catch (e) { return [] }
  },

  saveHistory(kw) {
    let h = this.data.history.filter(x => x !== kw)
    h.unshift(kw)
    h = h.slice(0, 10)
    this.setData({ history: h })
    try { wx.setStorageSync(HISTORY_KEY, h) } catch (e) { /* */ }
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value })
    if (!e.detail.value) {
      this.setData({ list: [], state: 'idle', cursor: null, hasMore: true })
    }
  },

  onConfirm() {
    const kw = this.data.keyword.trim()
    if (kw) this.search(kw)
  },

  onTagTap(e) {
    const kw = e.currentTarget.dataset.kw
    this.setData({ keyword: kw })
    this.search(kw)
  },

  onClearHistory() {
    this.setData({ history: [] })
    try { wx.removeStorageSync(HISTORY_KEY) } catch (e) { /* */ }
  },

  async search(kw) {
    if (this.data.searching) return
    this.setData({ searching: true, state: 'loading', list: [], cursor: null, hasMore: true })
    this.saveHistory(kw)
    try {
      await guard()
      const res = await api.postList({ keyword: kw, pageSize: 10 })
      this.setData({
        list: res.list,
        cursor: res.nextCursor,
        hasMore: res.hasMore,
        state: res.list.length ? 'success' : 'empty'
      })
    } catch (e) {
      if (e && e.silent) return
      this.setData({ state: 'error' })
    } finally {
      this.setData({ searching: false })
    }
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.searching || this.data.state !== 'success') return
    this.setData({ searching: true })
    try {
      const params = {
        keyword: this.data.keyword.trim(),
        pageSize: 10
      }
      if (this.data.cursor) params.cursor = this.data.cursor
      const res = await api.postList(params)
      this.setData({
        list: this.data.list.concat(res.list),
        cursor: res.nextCursor,
        hasMore: res.hasMore
      })
    } catch (e) {
      toast('加载失败')
    } finally {
      this.setData({ searching: false })
    }
  },

  onPostTap(e) {
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${e.detail.post.id}` })
  },

  onBack() { wx.navigateBack() },
  onEmptyAction() {
    wx.navigateTo({ url: '/pages/post/create/create?board=life' })
  }
})
