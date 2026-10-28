// S9 站内消息：互动通知（点赞/收藏/评论/审核结果）+ 全部已读
const api = require('../../../utils/api')
const { toast } = require('../../../utils/cloud')
const { guard } = require('../../../utils/auth')
const { timeAgo } = require('../../../utils/format')

const TYPE_META = {
  like: { icon: 'heart', label: '收到点赞' },
  fav: { icon: 'star', label: '收到收藏' },
  comment: { icon: 'comment', label: '收到评论' },
  reply: { icon: 'comment', label: '收到回复' },
  expiry: { icon: 'info', label: '过期提醒' },
  review_result: { icon: 'shield', label: '审核通知' },
  system: { icon: 'info', label: '系统通知' }
}

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    list: [],
    msgTab: 'all',
    counts: { all: 0, comment: 0, social: 0 },
    cursor: null,
    hasMore: true,
    state: 'loading',
    unread: 0
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

  async fetchList(reset) {
    if (reset) this.setData({ cursor: null })
    const res = await api.messages({
      tab: this.data.msgTab,
      pageSize: 20,
      cursor: this.data.cursor || undefined
    })
    const list = (reset ? res.list : this.data.list.concat(res.list)).map(m => ({
      ...m,
      icon: (TYPE_META[m.type] || TYPE_META.system).icon,
      timeText: timeAgo(m.createdAt)
    }))
    this.setData({
      list,
      counts: res.counts || this.data.counts,
      cursor: res.nextCursor,
      hasMore: res.hasMore,
      unread: (res.counts && res.counts.all) || 0,
      state: list.length ? 'success' : 'empty'
    })
  },

  async onMore() {
    if (!this.data.hasMore) return
    try { await this.fetchList(false) } catch (e) { /* */ }
  },

  onMsgTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.msgTab) return
    this.setData({ msgTab: key, list: [], state: 'loading' })
    this.fetchList(true).catch(() => this.setData({ state: 'error' }))
  },

  async onReadAll() {
    if (!this.data.unread) return
    try {
      const res = await api.messageReadAll()
      const list = this.data.list.map(m => ({ ...m, read: true }))
      const left = res.unread || 0
      // ⚠️ 各 Tab 未读数用服务端返回的 counts，不要硬编码 0
      // （服务端 meMessageRead 现在会返回 counts，口径与 meList 一致）
      const counts = res.counts || { all: left, comment: 0, social: 0 }
      this.setData({
        list,
        unread: left,
        counts
      })
      toast('已全部标记已读')
    } catch (e) {
      toast((e && e.msg) || '操作失败')
    }
  },

  async onTapMsg(e) {
    const idx = e.currentTarget.dataset.idx
    const m = this.data.list[idx]
    if (!m) return
    if (!m.read) {
      this.setData({ [`list[${idx}].read`]: true })
      api.messageRead(m.id).then(res => {
        // 服务端返回分类未读数 → 同步更新角标（不再只更总数）
        const left = res.unread || 0
        this.setData({
          unread: left,
          counts: res.counts || { all: left, comment: 0, social: 0 }
        })
      }).catch(() => {})
    }
    // 环境契约：跳转用 refId（非 postId）
    if (m.refType === 'post' && m.refId) {
      wx.navigateTo({ url: `/pages/post/detail/detail?id=${m.refId}` })
    }
  },

  onRetry() { this.firstLoad() },
  onEmptyAction() { wx.reLaunch({ url: '/pages/index/index' }) },
  onBack() { wx.navigateBack() }
})
