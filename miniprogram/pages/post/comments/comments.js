// S8 评论页：帖子摘要 + 一级评论流（匿名 #N）+ 楼中楼 + 底部圆形纸飞机发送
const api = require('../../../utils/api')
const { toast } = require('../../../utils/cloud')
const { guard } = require('../../../utils/auth')
const { timeAgo, countShort, randId } = require('../../../utils/format')

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    postId: '',
    postTitle: '',
    post: { title: '', timeText: '', commentCount: 0, likeCount: 0 },
    comments: [],
    total: 0,
    cursor: null,
    hasMore: false,
    state: 'loading',
    replyTo: null,
    draft: '',
    sending: false
  },

  onLoad(query) {
    this.setData({
      postId: query.id || '',
      postTitle: decodeURIComponent(query.title || '')
    })
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
      this.setData({ state: this.data.comments.length ? 'success' : 'empty' })
    } catch (e) {
      if (e && e.silent) return
      this.setData({ state: 'error' })
    }
  },

  async fetchList(reset) {
    if (reset) this.setData({ cursor: null })
    const res = await api.commentList(this.data.postId)
    const list = (res.list || []).map(c => ({
      ...c,
      mine: !!c.isMine,
      timeText: timeAgo(c.createdAt),
      likeShort: countShort(c.likeCount || 0),
      replies: (c.replies || []).map(r => ({ ...r, mine: !!r.isMine, timeText: timeAgo(r.createdAt) }))
    }))
    this.setData({
      comments: list,
      total: res.total || list.length,
      cursor: res.nextCursor,
      hasMore: !!res.hasMore,
      post: res.post || this.data.post
    })
  },

  onMore() {
    if (!this.data.hasMore) return
    this.fetchList(false)
      .catch(() => toast('加载失败'))
  },

  onInput(e) { this.setData({ draft: e.detail.value }) },

  onReplyTo(e) {
    // 环境契约：二级回复需 parentId（一级评论 _id）+ replyToFloor（被回复楼层）
    const { floor, id } = e.currentTarget.dataset
    this.setData({ replyTo: { floor, id } })
  },

  onCancelReply() { this.setData({ replyTo: null }) },

  async onSend() {
    const content = this.data.draft.trim()
    if (!content || this.data.sending) return
    this.setData({ sending: true })
    try {
      const payload = {
        postId: this.data.postId,
        content,
        clientReqId: randId(24)
      }
      if (this.data.replyTo && this.data.replyTo.id) {
        payload.parentId = this.data.replyTo.id
        payload.replyToFloor = this.data.replyTo.floor
      }
      const res = await api.commentCreate(payload)
      const c = {
        id: res.commentId,
        floor: res.floor,
        content,
        createdAt: Date.now(),
        status: res.status,
        replyToFloor: res.replyToFloor || 0,
        replies: [],
        replyCount: 0,
        mine: res.isMine !== false,
        timeText: '刚刚'
      }
      const comments = this.data.comments.slice()
      if (payload.parentId) {
        // 追加到对应一级评论的楼中楼
        let hit = false
        for (let i = 0; i < comments.length; i++) {
          if (comments[i].id === payload.parentId) {
            const t = comments[i]
            const replies = (t.replies || []).concat([c])
            comments[i] = { ...t, replies, replyCount: (t.replyCount || 0) + 1 }
            hit = true
            break
          }
        }
        if (!hit) comments.push(c)
      } else {
        comments.push(c)
      }
      this.setData({
        comments,
        total: this.data.total + 1,
        draft: '',
        replyTo: null,
        state: 'success',
        'post.commentCount': (this.data.post.commentCount || 0) + 1
      })
      getApp().globalData.feedDirty = true
      toast('已发布')
    } catch (e) {
      if (e && e.code === 40010) toast('评论包含不允许的内容')
      else toast((e && e.msg) || '发送失败')
    } finally {
      this.setData({ sending: false })
    }
  },

  onTapPost() {
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${this.data.postId}` })
  },

  async onExpand(e) {
    // 楼中楼展开：环境契约用 parentId 取该一级评论下的全部回复
    const { id, floor } = e.currentTarget.dataset
    wx.showLoading({ title: '加载中…', mask: true })
    api.commentList(this.data.postId, id)
      .then((res) => {
        wx.hideLoading()
        const comments = this.data.comments.map(c => {
          if (c.id !== id) return c
          const replies = (res.list || []).map(r => ({ ...r, mine: !!r.isMine, timeText: timeAgo(r.createdAt) }))
          return { ...c, replies, replyCount: replies.length }
        })
        this.setData({ comments })
      })
      .catch(() => {
        wx.hideLoading()
        toast('加载失败')
      })
  },

  onRetry() { this.firstLoad() },
  onBack() { wx.navigateBack() }
})
