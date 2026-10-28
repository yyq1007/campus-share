// S7 审核台：待审 / 举报 / 已处理 三 Tab + 通过/驳回/下线
// 契约：adminQueue tab=pending|report|done；adminReview action=approve|reject|hide|ignore|banUser
const api = require('../../utils/api')
const { toast } = require('../../utils/cloud')
const { guard } = require('../../utils/auth')
const { timeAgo } = require('../../utils/format')
const { getTempUrls } = require('../../utils/media')
const BOARD_LABEL = { life: '生活', study: '学习', food: '美食' }
const BOARD_STICKER = { life: 'sticker-lamp-solid', study: 'sticker-book-solid', food: 'sticker-bowl-solid' }
const AI_LABEL = {
  ad: '疑似广告', accuse: '疑似指控', contact: '疑似导流',
  spam: '疑似垃圾', porn: '疑似违规', other: '需人工判断'
}

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    tab: 'pending',        // pending|report|done
    counts: { pending: 0, report: 0, done: 0 },
    list: [],
    cursor: null,
    hasMore: true,
    state: 'loading',
    acting: false
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
    this.firstLoad()
  },

  async firstLoad() {
    this.setData({ state: 'loading' })
    try {
      await guard()
      // 权限校验在云函数 adminQueue 内再校验一次（role === admin）
      await this.fetchList(true)
    } catch (e) {
      if (e && e.silent) return
      this.setData({ state: e && e.code === 40301 ? 'denied' : 'error' })
    }
  },

  async fetchList(reset) {
    if (reset) this.setData({ cursor: null })
    const res = await api.adminQueue({
      tab: this.data.tab,
      pageSize: 10,
      cursor: this.data.cursor || undefined
    })
    const raw = reset ? res.list : this.data.list.concat(res.list)
    // 封面临时链接（媒体快照取首图）
    const coverIds = []
    raw.forEach(x => {
      ;(x.media || []).forEach(m => {
        if (m.fileId) coverIds.push(m.fileId)
        if (m.posterFileId) coverIds.push(m.posterFileId)
      })
    })
    let coverMap = {}
    if (coverIds.length) coverMap = await getTempUrls(coverIds)
    const list = raw.map(x => {
      const first = (x.media || [])[0] || {}
      const cover = coverMap[first.fileId] || coverMap[first.posterFileId] || ''
      // ⚠️ 兜底文案要用本地方法 this.doneText(x) 算，
      // 不能用 x.doneText —— 那是云函数出参里的字段，不存在时恒为 undefined，
      // 写成 `|| x.doneText` 等于没兜底（aiTag 会是空串）。
      const doneText = this.doneText(x)
      const aiText = AI_LABEL[x.aiLabel] || (x.aiLabel === '用户举报' ? '用户举报' : '') || doneText
      return {
        ...x,
        id: x.queueId,
        cover,
        boardLabel: BOARD_LABEL[x.board] || x.board || '',
        boardSticker: BOARD_STICKER[x.board] || 'sticker-lamp-solid',
        aiTag: aiText,
        reportReason: x.reporterReason || '',
        timeText: timeAgo(this.data.tab === 'done' ? (x.handledAt || x.createdAt) : x.createdAt),
        doneText
      }
    })
    this.setData({
      list,
      cursor: res.nextCursor,
      hasMore: !!res.hasMore,
      counts: res.counts || this.data.counts,
      state: list.length ? 'success' : 'empty'
    })
  },

  /** 已处理 Tab 的结果文案 */
  doneText(x) {
    if (x.status === 'approved') return '已通过'
    if (x.status === 'rejected') return x.source === 'report' ? '举报成立 · 内容已下线' : '已驳回'
    if (x.status === 'ignored') return x.source === 'report' ? '举报不成立 · 内容保留' : '已忽略'
    return ''
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.key
    if (tab === this.data.tab) return
    this.setData({ tab, list: [], state: 'loading' })
    this.fetchList(true).catch(() => this.setData({ state: 'error' }))
  },

  onMore() {
    if (!this.data.hasMore || this.data.acting) return
    this.fetchList(false).catch(() => toast('加载失败'))
  },

  onPreview(e) {
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ urls: [url] })
  },

  async onApprove(e) {
    await this.act('approve', e.currentTarget.dataset.id, '已通过')
  },

  async onReject(e) {
    const id = e.currentTarget.dataset.id
    // 举报 Tab：驳回 = 举报不成立（内容保留）→ action=ignore
    const isReport = this.data.tab === 'report'
    // ⚠️ 变量名不能与外层 Promise 的 resolve 同名：
    //    写成 success: r => r(...) 会用 showModal 的 result 遮蔽 resolve，
    //    调用时抛 "r is not a function" → Promise 永不 settle → await 永久挂起
    //    → 表现为「点了驳回没反应、多次点都没用」。
    const res = await new Promise(resolve => {
      wx.showModal({
        title: isReport ? '驳回举报理由' : '驳回原因',
        editable: true,
        placeholderText: isReport ? '说明举报不成立的原因' : '填写驳回原因（仅审核可见）',
        success: (r) => resolve(r.confirm ? (r.content || (isReport ? '举报不成立' : '不符合社区规范')) : false),
        fail: () => resolve(false)
      })
    })
    if (res === false) return
    await this.act(isReport ? 'ignore' : 'reject', id, isReport ? '举报已驳回' : '已驳回', res)
  },

  async onHide(e) {
    const id = e.currentTarget.dataset.id
    // 同 onReject：变量名不能遮蔽 resolve
    const res = await new Promise(resolve => {
      wx.showModal({
        title: '下线原因',
        editable: true,
        placeholderText: '填写下线原因（将通知作者）',
        success: (r) => resolve(r.confirm ? (r.content || '违反社区规范') : false),
        fail: () => resolve(false)
      })
    })
    if (res === false) return
    await this.act('hide', id, '已下线', res)
  },

  async act(action, queueId, okMsg, reason) {
    if (this.data.acting) return
    if (!queueId) {
      // 队列 ID 丢了（data-id 没绑上 / 字段名不对）→ 明确报错，别静默失败
      toast('缺少审核项 ID，操作失败')
      return
    }
    this.setData({ acting: true })
    try {
      const res = await api.adminReview(queueId, action, reason)
      // 云函数在「队列已改、目标内容更新失败」时返回 ok 但带 warning，
      // 这里必须提示出来，否则界面会以为处理成功而实际没生效
      if (res && res.ok === false && res.warning) {
        toast(res.warning)
      } else {
        toast(okMsg)
      }
      // 本地移除并扣减计数
      const list = this.data.list.filter(x => x.queueId !== queueId)
      const counts = { ...this.data.counts }
      if (this.data.tab === 'pending') counts.pending = Math.max(0, counts.pending - 1)
      else if (this.data.tab === 'report') counts.report = Math.max(0, counts.report - 1)
      this.setData({ list, counts, state: list.length ? 'success' : 'empty' })
    } catch (err) {
      toast((err && err.msg) || '操作失败')
      // 失败后重新拉一次队列：可能已被别人处理过，本地列表是脏的
      this.fetchList(true).catch(() => {})
    } finally {
      this.setData({ acting: false })
    }
  },

  onRetry() { this.firstLoad() },
  onBack() { wx.navigateBack() }
})
