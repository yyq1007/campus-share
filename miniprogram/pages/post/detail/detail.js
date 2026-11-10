// S4 详情页：帖子全文 + 图集 + 结构化字段 + 评论楼层 + 点赞收藏分享
const api = require('../../../utils/api')
const { toast } = require('../../../utils/cloud')
const { guard } = require('../../../utils/auth')
const { BOARDS } = require('../../../utils/config')
const { timeAgo, countShort, linkHost, randId, commentAvatarIndex } = require('../../../utils/format')
const { getTempUrls } = require('../../../utils/media')
const { patchPost } = require('../../../utils/post-sync')

// 楼中楼身份：楼主 / 层主 / 其他匿名同学（tag 由 commentList 计算）
const REPLY_NICK = { op: '楼主', layer: '层主' }
function decorateReply(r) {
  return { ...r, mine: !!r.isMine, nick: REPLY_NICK[r.tag] || '匿名同学', timeText: timeAgo(r.createdAt) }
}

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    post: null,
    state: 'loading',       // loading|success|error|gone
    comments: [],
    commentCursor: null,
    commentHasMore: false,
    commentTotal: 0,
    commentDraft: '',
    replyTo: null,          // { floor, nick }
    sending: false,
    imgIdx: 0
  },

  onLoad(query) {
    this.postId = query.id || ''
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
      const post = this.decorate(await api.postDetail(this.postId))
      // 图片临时链接
      // 视频：url 必须是视频本体（fileId），poster 才是封面图（posterFileId）——此前误用封面当播放源导致 00:00 黑屏
      const fileIds = []
      // ⚠️ media 可能是 undefined/null（老数据或接口缺字段），
      //    直接 forEach 会抛错并把整页转成 error 态 → 正文都看不到
      ;(post.media || []).forEach(m => {
        if (m.fileId) fileIds.push(m.fileId)
        if (m.posterFileId) fileIds.push(m.posterFileId)
      })
      if (fileIds.length) {
        const map = await getTempUrls(fileIds)
        post.mediaView = (post.media || []).map(m => ({
          type: m.type,
          url: map[m.fileId] || '',
          poster: m.type === 'video' ? (map[m.posterFileId] || '') : '',
          duration: m.duration || 0,
          w: m.w || 0,
          h: m.h || 0
        })).filter(m => m.url)
        // 轮播高度按首图宽高比自适应（竖图完整可见，上限约 1.6 屏高）
        const first = post.mediaView.find(m => m.type === 'image')
        if (first && first.w > 0) {
          const ratio = first.h / first.w
          post.galleryH = Math.round(Math.min(Math.max(ratio * 670, 300), 1080))
        }
      } else {
        post.mediaView = []
      }
      if (post.link) post.linkHost = linkHost(post.link)
      this.setData({ post, state: 'success' })
      this.loadComments(true)
    } catch (e) {
      // ⚠️ silent 错误 = 正在跳转邀请码页/登录态刷新，不该把页面打成 error 态
      //    （会闪一下错误页，然后被 reLaunch 覆盖，体验很糟）
      if (e && e.silent) return
      console.error('[detail:firstLoad]', e)
      this.setData({ state: e && e.code === 40402 ? 'gone' : 'error' })
    }
  },

  decorate(p) {
    const b = BOARDS[p.board] || {}
    p.boardLabel = b.label || p.board
    p.boardColor = b.color || 'mint'
    p.timeText = timeAgo(p.createdAt)
    p.boardSticker = (b && b.sticker) || 'sticker-lamp'
    p.citedCount = p.citedCount || 0
    p.likeShort = countShort(p.likeCount)
    p.favShort = countShort(p.favCount)
    p.commentShort = countShort(p.commentCount)
    p.fieldRows = []
    const fieldMeta = (b.fields || [])
    for (const f of fieldMeta) {
      if (p.fields && p.fields[f.key]) p.fieldRows.push({ key: f.key, label: f.label, value: p.fields[f.key] })
    p.fieldChips = p.fieldRows.map(r => ({
      label: r.key === 'price' ? ('¥' + r.value) : r.value,
      value: r.value
    }))
    }
    return p
  },

  // ---------- 评论 ----------
  async loadComments(reset) {
    if (reset) this.setData({ commentCursor: null })
    const res = await api.commentList(this.postId, '', reset ? '' : this.data.commentCursor)
    const page = (res.list || []).map(c => ({
      ...c,
      mine: !!c.isMine,
      timeText: timeAgo(c.createdAt),
      replies: (c.replies || []).map(decorateReply)
    }))
    const list = reset ? page : this.data.comments.concat(page)
    this.setData({
      comments: list,
      commentCursor: res.nextCursor,
      commentHasMore: !!res.hasMore,
      commentTotal: res.total || list.length
    })
  },

  onMoreComments() {
    if (!this.data.commentHasMore || this._loadingComments) return
    this._loadingComments = true
    this.loadComments(false)
      .catch(() => toast('加载失败'))
      .then(() => { this._loadingComments = false })
  },

  /** 展开某条一级评论下的全部回复（列表里默认只内嵌 3 条） */
  async onExpandReplies(e) {
    const { id } = e.currentTarget.dataset
    try {
      const res = await api.commentList(this.postId, id)
      const replies = (res.list || []).map(decorateReply)
      const idx = this.data.comments.findIndex(c => c.id === id)
      if (idx < 0) return
      this.setData({
        [`comments[${idx}].replies`]: replies,
        [`comments[${idx}].replyCount`]: replies.length
      })
    } catch (err) {
      toast('加载失败')
    }
  },

  onCommentInput(e) { this.setData({ commentDraft: e.detail.value }) },

  onPickReply(e) {
    const { floor, id } = e.currentTarget.dataset
    this.setData({ replyTo: { floor, id } })
  },

  onCancelReply() { this.setData({ replyTo: null }) },

  async onSendComment() {
    const content = this.data.commentDraft.trim()
    if (!content || this.data.sending) return
    this.setData({ sending: true })
    try {
      // 环境契约：二级回复需传 parentId（一级评论 _id）与 replyToFloor（被回复楼层）
      const payload = {
        postId: this.postId,
        content,
        clientReqId: randId(24)
      }
      if (this.data.replyTo && this.data.replyTo.id) {
        payload.parentId = this.data.replyTo.id
        payload.replyToFloor = this.data.replyTo.floor
      }
      const res = await api.commentCreate(payload)
      // ⚠️ 云函数没返回 commentId/floor 时不能硬塞 undefined：
      //    detail.wxml 的评论列表用 wx:key="floor"，floor 为 undefined 会导致
      //    key 重复 → 列表渲染错乱（评论串行/覆盖）。
      //    这里做兜底：拿不到有效值就提示失败并重新拉取列表。
      if (!res || !res.commentId) {
        this.setData({ sending: false })
        toast('评论已提交，正在刷新列表')
        this.loadComments(true).catch(() => {})
        return
      }
      const floor = Number(res.floor) || 0
      // 出参无 comment 对象，前端自行构造一条展示
      const c = {
        id: res.commentId,
        floor,
        avatarIdx: commentAvatarIndex(floor),
        content,
        createdAt: Date.now(),
        status: res.status,
        replyToFloor: res.replyToFloor || 0,
        replyCount: 0,
        replies: [],
        mine: res.isMine !== false,
        tag: this.data.post && this.data.post.isMine ? 'op' : '',
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
        if (!hit) comments.unshift(c)
      } else {
        // 列表按楼层倒序（新的在上），新评论放最上面
        comments.unshift(c)
      }
      this.setData({
        comments,
        commentTotal: this.data.commentTotal + 1,
        commentDraft: '',
        replyTo: null
      })
      const commentCount = (this.data.post.commentCount || 0) + 1
      this.setData({ 'post.commentCount': commentCount, 'post.commentShort': countShort(commentCount) })
      toast('已发布')
    } catch (e) {
      if (e && e.code === 40010) {
        toast('评论包含不允许的内容')
      } else {
        toast((e && e.msg) || '发送失败')
      }
    } finally {
      this.setData({ sending: false })
    }
  },

  // ---------- 互动 ----------
  async onLike() {
    const p = this.data.post
    const active = !p.liked
    const likeCount = Math.max(0, (p.likeCount || 0) + (active ? 1 : -1))
    this.setData({
      'post.liked': active,
      'post.likeCount': likeCount,
      'post.likeShort': countShort(likeCount)
    })
    if (active) wx.vibrateShort({ type: 'light' })
    try {
      await api.interactionToggle(this.postId, 'like')
      patchPost(this.postId, { liked: active, likeCount })
    } catch (e) {
      this.setData({ 'post.liked': p.liked, 'post.likeCount': p.likeCount, 'post.likeShort': p.likeShort })
    }
  },

  async onFav() {
    const p = this.data.post
    const active = !p.faved
    const favCount = Math.max(0, (p.favCount || 0) + (active ? 1 : -1))
    this.setData({
      'post.faved': active,
      'post.favCount': favCount,
      'post.favShort': countShort(favCount)
    })
    if (active) wx.vibrateShort({ type: 'light' })
    try {
      await api.interactionToggle(this.postId, 'fav')
      patchPost(this.postId, { faved: active, favCount })
      if (active) toast('已收藏')
    } catch (e) {
      this.setData({ 'post.faved': p.faved, 'post.favCount': p.favCount, 'post.favShort': p.favShort })
    }
  },

  // ---------- 媒体 ----------
  onSwiperChange(e) { this.setData({ imgIdx: e.detail.current }) },

  onPreview(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    // ⚠️ previewImage 只能预览图片：mediaView 里混着视频项（url 是视频本体），
    //    全部传进去会导致该张预览失败。
    //    dataset.idx 是 mediaView 的下标（swiper 遍历 mediaView），
    //    这里换算成「只含图片」的子集下标。
    const view = this.data.post.mediaView || []
    const images = view.filter(m => m.type === 'image')
    const urls = images.map(m => m.url)
    if (!urls.length) return
    // 第 idx 项在 mediaView 里是图片 → 它在 images 里的位置就是前面图片的数量
    let safeIdx = 0
    if (view[idx] && view[idx].type === 'image') {
      safeIdx = view.slice(0, idx).filter(m => m.type === 'image').length
    }
    safeIdx = Math.max(0, Math.min(safeIdx, urls.length - 1))
    wx.previewImage({ urls, current: urls[safeIdx] })
  },

  onCopyLink() {
    wx.setClipboardData({
      data: this.data.post.link,
      success: () => toast('链接已复制')
    })
  },

  // 删除自己的帖子（详情页入口；「我的分享」列表另有删除按钮）
  async onDeletePost() {
    if (!this.data.post || !this.data.post.isMine) return
    const confirmed = await new Promise(resolve => {
      wx.showModal({
        title: '删除分享',
        content: '删除后不可恢复，确定吗？',
        confirmColor: '#E5484D',
        success: res => resolve(res.confirm)
      })
    })
    if (!confirmed) return
    try {
      await api.postDelete(this.postId)
      patchPost(this.postId, { deleted: true })
      toast('已删除')
      getApp().globalData.feedDirty = true
      setTimeout(() => wx.navigateBack(), 800)
    } catch (e) {
      toast((e && e.msg) || '删除失败')
    }
  },

  onReport() {
    // reasonCode 必须落在服务端白名单：spam/porn/ad/abuse/fake/privacy/other
    const REASONS = ['垃圾广告', '不实信息', '人身攻击', '其他']
    const KEYS = ['ad', 'fake', 'abuse', 'other']
    wx.showActionSheet({
      itemList: REASONS,
      success: async (r) => {
        const reasonCode = KEYS[r.tapIndex] || 'other'
        try {
          await api.reportCreate('post', this.postId, reasonCode)
          toast('举报已提交，我们会尽快核实')
        } catch (e) {
          toast((e && e.msg) || '举报失败')
        }
      },
      fail: () => {}
    })
  },

  onCopyField(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.value,
      success: () => toast('已复制')
    })
  },

  onOpenLink() {
    const link = this.data.post.link
    wx.setClipboardData({
      data: link,
      success: () => wx.showModal({
        title: '链接已复制',
        content: '请在浏览器中打开该链接查看商品',
        showCancel: false
      })
    })
  },

  // ---------- 分享 / 保存 ----------
  onShareAppMessage() {
    const p = this.data.post
    return {
      title: p.title,
      path: `/pages/post/detail/detail?id=${this.postId}`,
      imageUrl: p.mediaView && p.mediaView[0] ? p.mediaView[0].url : undefined
    }
  },

  async onSaveImages() {
    const urls = (this.data.post.mediaView || []).filter(m => m.type === 'image').map(m => m.url)
    if (!urls.length) return toast('没有可保存的图片')
    try {
      for (const url of urls) {
        const dl = await this.download(url)
        await this.saveToAlbum(dl)
      }
      toast('已保存到相册')
    } catch (e) {
      if (e && e.errMsg && e.errMsg.indexOf('auth') >= 0) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存到相册',
          success: r => { if (r.confirm) wx.openSetting() }
        })
      } else {
        toast('保存失败')
      }
    }
  },

  download(url) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url,
        success: r => resolve(r.tempFilePath),
        fail: reject
      })
    })
  },

  saveToAlbum(path) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({ filePath: path, success: resolve, fail: reject })
    })
  },

  onRetry() { this.firstLoad() },
  onBack() { wx.navigateBack() }
})
