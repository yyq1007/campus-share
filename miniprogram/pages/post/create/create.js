// S3 发帖页：板块胶囊 + 动态字段 + 图/视互斥上传 + 链接过滤 + 草稿 + 幂等发布
const api = require('../../../utils/api')
const { toast } = require('../../../utils/cloud')
const { guard, getUid } = require('../../../utils/auth')
const { BOARDS, BOARD_KEYS, LIMITS } = require('../../../utils/config')
const { chooseImages, chooseVideo, uploadImage, uploadVideo, uploadFile } = require('../../../utils/media')
const { countChars, normalizeText, cleanContent, validLink, randId } = require('../../../utils/format')

const DRAFT_KEY = 'draft_post_'

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    boards: BOARD_KEYS.map(k => ({ key: k, label: BOARDS[k].label, color: BOARDS[k].color })),
    board: 'life',
    fieldList: [],
    fields: {},
    title: '',
    content: '',
    link: '',
    media: [],             // [{ type, localPath, thumb, size, uploaded, fileId, progress }]
    mediaType: 'none',     // none|image|video
    submitting: false,
    titleCount: 0,
    contentCount: 0,
    linkFocus: false
  },

  onLoad(query) {
    const board = BOARD_KEYS.indexOf(query.board) >= 0 ? query.board : 'life'
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
    this._clientReqId = randId(24)
    this._uid = ''
    this.switchBoard(board, { silent: true })
    this.restoreDraft(board)
  },

  onUnload() {
    // 有实质内容且未提交成功 → 自动存草稿
    if (!this._submitted && this.hasDraft()) this.saveDraft()
  },

  hasDraft() {
    return !!(this.data.title.trim() || this.data.content.trim() || this.data.media.length)
  },

  switchBoard(board, opts = {}) {
    const fields = {}
    const fieldList = BOARDS[board].fields.map(f => ({ ...f, value: '' }))
    if (!opts.silent) this.setData({ board, fieldList, fields })
    else this.setData({ board, fieldList })
    return fieldList
  },

  onBoardTap(e) {
    const board = e.currentTarget.dataset.key
    if (board === this.data.board) return
    if (this.hasDraft()) this.saveDraft()
    this.switchBoard(board)
    this.restoreDraft(board)
  },

  // ---------- 草稿（按板块独立存取） ----------
  draftKey() { return DRAFT_KEY + this.data.board },

  saveDraft() {
    try {
      wx.setStorageSync(this.draftKey(), {
        title: this.data.title,
        content: this.data.content,
        link: this.data.link,
        fields: this.data.fields,
        at: Date.now()
      })
    } catch (e) { /* 存储失败不阻塞 */ }
  },

  restoreDraft(board) {
    try {
      const d = wx.getStorageSync(DRAFT_KEY + board)
      if (!d || !d.title) {
        this.setData({ title: '', content: '', link: '', fields: {}, titleCount: 0, contentCount: 0 })
        return
      }
      const fieldList = BOARDS[board].fields.map(f => ({ ...f, value: (d.fields && d.fields[f.key]) || '' }))
      this.setData({
        title: d.title || '', content: d.content || '', link: d.link || '',
        fields: d.fields || {}, fieldList,
        titleCount: countChars(d.title), contentCount: countChars(d.content)
      })
      toast('已恢复上次草稿')
    } catch (e) {
      this.setData({ title: '', content: '', link: '', fields: {}, titleCount: 0, contentCount: 0 })
    }
  },

  clearDraft() {
    try { wx.removeStorageSync(this.draftKey()) } catch (e) { /* */ }
  },

  // ---------- 输入 ----------
  onTitle(e) {
    const v = e.detail.value
    if (countChars(v) > LIMITS.titleMax) return
    this.setData({ title: v, titleCount: countChars(v) })
  },

  onContent(e) {
    const v = e.detail.value
    if (countChars(v) > LIMITS.contentMax) return
    this.setData({ content: v, contentCount: countChars(v) })
  },

  onLink(e) {
    this.setData({ link: e.detail.value.trim() })
  },

  onLinkBlur() {
    const link = this.data.link
    if (link && !validLink(link)) {
      toast('链接需以 http(s):// 开头')
      this.setData({ linkFocus: true })
    }
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    const type = e.currentTarget.dataset.type
    let v = e.detail.value
    if (type === 'digit') v = v.replace(/[^\d.]/g, '')
    const fields = { ...this.data.fields, [key]: v }
    const fieldList = this.data.fieldList.map(f => f.key === key ? { ...f, value: v } : f)
    this.setData({ fields, fieldList })
  },

  // ---------- 媒体（图视互斥，单入口） ----------
  // 单一上传入口：先弹选择面板分发到图片/视频（onAddVideo 保留为分发目标）
  async onAddMedia() {
    if (this.data.submitting) return
    const mt = this.data.mediaType
    if (mt === 'video') {
      return toast('已选了视频，先删除才能换图片')
    }
    const items = await new Promise(resolve => {
      wx.showActionSheet({
        itemList: ['图片（最多 6 张）', '视频（1 个）'],
        success: res => resolve(res.tapIndex),
        fail: () => resolve(-1)
      })
    })
    if (items === 0) return this.addImages()
    if (items === 1) return this.onAddVideo()
    /* 用户取消 */
  },

  async addImages() {
    if (this.data.submitting) return
    if (this.data.mediaType === 'video') {
      return toast('图与视频只能选一种，先删除视频')
    }
    const remain = LIMITS.maxImages - this.data.media.length
    if (remain <= 0) return toast(`最多 ${LIMITS.maxImages} 张图`)
    try {
      const items = await chooseImages(remain)
      const media = this.data.media.concat(items.map(it => ({
        type: 'image', localPath: it.localPath, size: it.size, w: it.w, h: it.h,
        uploaded: false, fileId: '', progress: 0
      })))
      this.setData({ media, mediaType: 'image' })
    } catch (e) { /* 用户取消 */ }
  },

  async onAddVideo() {
    if (this.data.submitting) return
    if (this.data.mediaType === 'image') {
      return toast('图与视频只能选一种，先删除图片')
    }
    try {
      const items = await chooseVideo()
      this.setData({
        media: items.map(it => ({ type: 'video', localPath: it.localPath, thumb: it.thumb, size: it.size, duration: it.duration, uploaded: false, fileId: '', progress: 0 })),
        mediaType: 'video'
      })
    } catch (e) {
      if (e && e.msg) toast(e.msg)
    }
  },

  onRemoveMedia(e) {
    const idx = e.currentTarget.dataset.idx
    const media = this.data.media.filter((_, i) => i !== idx)
    this.setData({ media, mediaType: media.length ? this.data.mediaType : 'none' })
  },

  onPreviewImage(e) {
    const idx = e.currentTarget.dataset.idx
    const urls = this.data.media.filter(m => m.type === 'image').map(m => m.localPath)
    wx.previewImage({ urls, current: urls[idx] })
  },

  // ---------- 上传（并发 2） ----------
  async uploadAllMedia() {
    if (!this._uid) this._uid = getUid() || 'u'
    const media = this.data.media
    const out = []
    let done = 0
    const queue = media.map((m, i) => ({ m, i }))
    const worker = async () => {
      while (queue.length) {
        const { m, i } = queue.shift()
        let rec
        if (m.type === 'image') rec = await uploadImage(m, this._uid)
        else rec = await uploadVideo(m, this._uid)
        // 送审登记 mediaAssets（9.19）：postCreate 强校验台账，缺记录会报「媒体文件无效」；
        // 送审失败不阻断发布（服务端对无记录媒体按 unknown 容忍处理）
        try {
          await api.mediaCheck({
            fileId: rec.fileId,
            checkFileId: rec.checkFileId || '',
            type: rec.type
          })
        } catch (e) {
          console.error('[mediaCheck] 送审失败，继续发布', rec.fileId, e)
        }
        out[i] = rec
        done++
        this.setData({ [`media[${i}].uploaded`]: true, [`media[${i}].progress`]: Math.round(done / media.length * 100) })
      }
    }
    await Promise.all([worker(), worker()])
    return out.filter(Boolean)
  },

  // ---------- 提交 ----------
  validate() {
    const title = normalizeText(this.data.title)
    const content = cleanContent(this.data.content)
    if (countChars(title) < 2) return '标题至少 2 个字'
    if (countChars(title) > LIMITS.titleMax) return `标题最多 ${LIMITS.titleMax} 字`
    if (countChars(content) < LIMITS.contentMin) return `正文至少 ${LIMITS.contentMin} 个字`
    if (countChars(content) > LIMITS.contentMax) return `正文最多 ${LIMITS.contentMax} 字`
    if (this.data.link && !validLink(this.data.link)) return '链接格式不正确'
    return ''
  },

  async onSubmit() {
    if (this.data.submitting) return
    const err = this.validate()
    if (err) return toast(err)
    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中…', mask: true })
    try {
      await guard()
      const media = await this.uploadAllMedia()
      const fields = {}
      for (const f of this.data.fieldList) {
        const v = normalizeText(this.data.fields[f.key] || '')
        if (v) fields[f.key] = v
      }
      // 环境契约：链接属于 fields.link（服务端会派生 linkHost 并校验格式）
      if (this.data.link) fields.link = this.data.link
      const res = await api.postCreate({
        board: this.data.board,
        title: normalizeText(this.data.title),
        content: cleanContent(this.data.content),
        fields,
        media,
        clientReqId: this._clientReqId
      })
      this._submitted = true
      this.clearDraft()
      wx.hideLoading()
      getApp().globalData.feedDirty = true
      if (res && res.status === 'pending') {
        toast('已提交，审核通过后展示')
        setTimeout(() => wx.navigateBack(), 1200)
      } else {
        toast('发布成功')
        setTimeout(() => wx.navigateBack(), 800)
      }
    } catch (e) {
      wx.hideLoading()
      if (e && e.code === 40010) {
        // 敏感词驳回：直接拒绝，不落库；只提示位置，不回显词条
        this._clientReqId = randId(24) // 换幂等键允许修改后重发
        wx.showModal({
          title: '内容需要修改',
          content: '内容包含不允许发布的文字，请调整标红位置后再发布。',
          showCancel: false
        })
        const ranges = (e.data && e.data.ranges) || []
        this.applyRejectRanges(ranges)
      } else if (e && e.code === 40001) {
        toast(e.msg || '请检查填写内容')
      } else {
        toast((e && e.msg) || '发布失败，请重试')
      }
    } finally {
      this.setData({ submitting: false })
    }
  },

  /** 驳回区间正文标红（highlight 数组下标集合） */
  applyRejectRanges(ranges) {
    if (!ranges.length) return
    // 简化实现：记录区间供 wxml 分段渲染
    const marks = ranges.map(r => ({ start: r.start, end: r.end }))
    this.setData({ rejectMarks: marks })
  },

  // ---------- 分享 ----------
  onShareAppMessage() {
    return { title: '我在「好物分享」发了一条好物，快来看看', path: '/pages/index/index' }
  },

  onBack() { wx.navigateBack() },

  onRetry() { /* 预留 */ }
})
