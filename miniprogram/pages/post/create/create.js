// S3 发帖页：板块胶囊 + 动态字段 + 图/视互斥上传 + 链接过滤 + 草稿 + 幂等发布
// 拍照即发帖（9.22）：data.assist 状态机叠加在既有表单之上，
// 五个交互状态 idle → shooting → analyzing → prefilled → submitted（fail 自动回 idle），
// 不改变任何既有字段与提交流程；AI 只填空、从不覆盖用户输入。
const api = require('../../../utils/api')
const { toast } = require('../../../utils/cloud')
const { guard, getUid } = require('../../../utils/auth')
const { hasAgreed } = require('../../../utils/privacy')
const { BOARDS, BOARD_KEYS, LIMITS } = require('../../../utils/config')
const { chooseImages, chooseSingleImage, chooseVideo, uploadImage, uploadVideo, uploadFile, getTempUrls } = require('../../../utils/media')
const { countChars, clipChars, normalizeText, cleanContent, validLink, randId } = require('../../../utils/format')

const DRAFT_KEY = 'draft_post_'
const MAX_DRAFTS = 12               // 草稿箱上限（超出淘汰最旧），防存储膨胀

// 拍照即发帖常量（契约见交互稿第五章）
const ASSIST_TIMEOUT_MS = 22000      // 前端 22s 兜底：实测链路=压缩上传(~6s)+冷启动(0.5s)+视觉模型(~9s)≈15s+，12s 会误杀成功结果（2026-11-15 线上埋点 analyze_fail reason=超时 证实）
const ASSIST_PHASE_MS = 2500         // 分析屏文案轮换间隔
const ASSIST_PHASES = ['在认物品…', '在写标题和简介…', '在估价格挑板块…']
const ASSIST_CONF_LOW = 0.6          // 低置信度：标题留空 + 黄条，不硬编内容

function pad2(n) { return n < 10 ? '0' + n : '' + n }
function fmtWhen(at) {
  if (!at) return ''
  const d = new Date(at)
  const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm
}

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    boards: BOARD_KEYS.map(k => ({ key: k, label: BOARDS[k].label, color: BOARDS[k].color })),
    board: 'life',
    // 该板块是否提供「购买链接」输入框（只有生活板块为 true）
    allowLink: !!BOARDS.life.allowLink,
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
    linkFocus: false,

    // ---------- 拍照即发帖（9.22）----------
    assistState: 'idle',   // idle|shooting|analyzing|prefilled|submitted
    assistAvailable: false, // 隐私协议已同意才显示 AI 入口卡（needInvite 用户被 guard 拦在本页之外）
    assistPhoto: '',       // analyzing 覆盖层展示的照片（localPath）
    assistPhaseText: '',   // 轮换文案
    assistSuggest: null,   // postAssist 原始建议（tags/observations 用）
    assistBoardTop: '',    // 板块建议主判定 key（不自动切换，胶囊手动点选永远优先）
    assistBoardConf: 0,
    assistBoardRunner: '', // 次选 key
    assistBoardConf2: 0,
    assistLowConf: false,  // 低置信度黄条
    assistFieldKey: '',    // AI 预填的动态字段 key（✦ 标记用）
    aiMarks: { title: false, content: false, field: false }, // ✦ 字段级来源标记：开始编辑即移除
    assistPreviewCover: '', // submitted 成功页帖子预览图
    submitStatus: '',       // submitted 成功页状态告知（published/pending）
    draftBoxShow: false,    // 草稿箱抽屉
    draftList: [],          // 草稿箱列表（板块+摘要+图数+时间）
    cameraShow: false       // 自拍相机浮层（camera 组件：takePhoto 不进系统相册）
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
    // 拍照即发帖：会话级状态（不进 data，避免渲染开销）
    this._assistSeq = 0        // 迟到结果丢弃守卫：只有最新一次分析的结果才允许落地
    this._assistFileId = ''    // 本次分析用的已上传 fileId（regen 复用）
    this._assistUsed = false   // 提交时是否带 aiAssist:true
    this._cameraIntent = ''    // 自拍相机的用途：assist（识图）/ add（加图）
    // 进入即空白：不自动恢复草稿，需要时从草稿箱取（2026-11-16 用户反馈）
    this.switchBoard(board, { silent: true })
  },

  onShow() {
    // AI 入口卡显隐：隐私协议门禁激活时隐藏，不暴露函数存在
    this.setData({ assistAvailable: hasAgreed() })
  },

  onUnload() {
    // 有实质内容且未提交成功 → 自动存草稿
    if (!this._submitted && this.hasDraft()) this.saveDraft()
    this.clearAssistTimers()
  },

  hasDraft() {
    return !!(this.data.title.trim() || this.data.content.trim() || this.data.media.length)
  },

  switchBoard(board, opts = {}) {
    const fields = {}
    const fieldList = BOARDS[board].fields.map(f => ({ ...f, value: '' }))
    // 只有生活板块有链接输入；切到学习/美食要把 link 清掉，
    // 否则上一板块填的链接会跟着提交（服务端不按板块过滤 link）
    const allowLink = !!BOARDS[board].allowLink
    const link = allowLink ? this.data.link : ''
    if (!opts.silent) this.setData({ board, fieldList, fields, allowLink, link })
    else this.setData({ board, fieldList, allowLink, link })
    return fieldList
  },

  onBoardTap(e) {
    const board = e.currentTarget.dataset.key
    if (board === this.data.board) return
    // 先把当前板块完整快照存进草稿箱（随时可找回），再切板块
    this.saveDraft()
    // 切板块保留当前内容（标题/正文/图片/AI 建议）：点 AI 次选胶囊时
    // 用户期望「当前内容换个板块」，而不是跳去目标板块的历史草稿
    this.switchBoard(board)
    // ✦ 字段标记指向旧板块的字段集（fields 已随 switchBoard 重建为空），同步清掉
    if (this.data.aiMarks.field) {
      this.setData({ aiMarks: { ...this.data.aiMarks, field: false }, assistFieldKey: '' })
    }
  },

  // ---------- 草稿（按板块完整隔离：文字+图片+AI 元数据一起存取） ----------
  draftKey(id) { return DRAFT_KEY + id },

  /** 当前页面状态快照 → 草稿对象 */
  _snapshot() {
    return {
      title: this.data.title,
      content: this.data.content,
      link: this.data.link,
      fields: this.data.fields,
      media: this.data.media.map(m => ({
        lid: m.lid, type: m.type, localPath: m.localPath, size: m.size,
        w: m.w, h: m.h, uploaded: m.uploaded, fileId: m.fileId
      })),
      // AI 元数据：✦ 标记、板块建议、低置信黄条随草稿走，切板块不丢
      ai: {
        marks: { ...this.data.aiMarks },
        fieldKey: this.data.assistFieldKey,
        boardTop: this.data.assistBoardTop,
        boardConf: this.data.assistBoardConf,
        boardRunner: this.data.assistBoardRunner,
        boardConf2: this.data.assistBoardConf2,
        lowConf: this.data.assistLowConf,
        prefilled: this.data.assistState === 'prefilled',
        used: this._assistUsed
      },
      at: Date.now()
    }
  },

  /** 追加式保存：每次存一条新草稿，绝不覆盖旧条目（2026-11-16 用户反馈「以前的没存进去」
      —— 旧实现按板块单槽位覆盖，切板块时把历史草稿冲掉了）。
      同板块最新一条内容完全相同则跳过，防来回切换产生重复条目。 */
  saveDraft(board) {
    try {
      const b = board || this.data.board
      // 空状态不落盘
      if (!this.hasDraft() && !this._assistUsed) return
      const snap = this._snapshot()
      snap.board = b
      const sig = JSON.stringify([
        snap.title, snap.content, snap.link, snap.fields,
        snap.media.map(m => [m.localPath, m.fileId, m.uploaded])
      ])
      let keys = []
      try { keys = wx.getStorageInfoSync().keys || [] } catch (e) { keys = [] }
      for (const k of keys.filter(k => k.indexOf(DRAFT_KEY) === 0)) {
        let d = null
        try { d = wx.getStorageSync(k) } catch (e) { d = null }
        // 一模一样的内容（同板块）→ 不重复追加
        if (d && d.sig === sig) return
      }
      snap.sig = sig
      wx.setStorageSync(this.draftKey(randId(12)), snap)
      // 超上限：按时间淘汰最旧
      const all = []
      for (const k of keys.filter(k => k.indexOf(DRAFT_KEY) === 0)) {
        let d = null
        try { d = wx.getStorageSync(k) } catch (e) { continue }
        if (d) all.push({ k, at: d.at || 0 })
      }
      if (all.length > MAX_DRAFTS) {
        all.sort((a, b) => a.at - b.at)
        for (const old of all.slice(0, all.length - MAX_DRAFTS)) {
          try { wx.removeStorageSync(old.k) } catch (e) { /* */ }
        }
      }
    } catch (e) { /* 存储失败不阻塞 */ }
  },

  /** 从草稿箱按条目恢复（key = 草稿存储键）：自动切到草稿所属板块；恢复后移除该条目 */
  restoreDraft(key, fallbackBoard) {
    let d = null
    try { d = wx.getStorageSync(key) } catch (e) { /* */ }
    let board = (d && d.board) || fallbackBoard
    if (BOARD_KEYS.indexOf(board) < 0) board = 'life'
    if (board !== this.data.board) this.switchBoard(board)
    const hasContent = !!(d && (d.title || (d.media && d.media.length)))
    if (!hasContent) {
      // 草稿为空/损坏 → 全清（图片也要清，否则上一个板块的图会跟过来）
      this.setData({
        title: '', content: '', link: '', fields: {},
        titleCount: 0, contentCount: 0,
        media: [], mediaType: 'none',
        aiMarks: { title: false, content: false, field: false },
        assistFieldKey: '', assistBoardTop: '', assistBoardConf: 0,
        assistBoardRunner: '', assistBoardConf2: 0,
        assistLowConf: false, assistState: 'idle'
      })
      this._assistUsed = false
      return
    }
    const fieldList = BOARDS[board].fields.map(f => ({ ...f, value: (d.fields && d.fields[f.key]) || '' }))
    const media = (d.media || []).map(m => ({ ...m, progress: m.uploaded ? 100 : 0 }))
    const ai = d.ai || {}
    this.setData({
      title: d.title || '', content: d.content || '',
      // 学习/美食板块不恢复链接（老草稿里可能存着 link）
      link: BOARDS[board].allowLink ? (d.link || '') : '',
      fields: d.fields || {}, fieldList,
      titleCount: countChars(d.title), contentCount: countChars(d.content),
      media, mediaType: media.length ? (media[0].type === 'video' ? 'video' : 'image') : 'none',
      aiMarks: ai.marks || { title: false, content: false, field: false },
      assistFieldKey: ai.fieldKey || '',
      assistBoardTop: ai.boardTop || '',
      assistBoardConf: ai.boardConf || 0,
      assistBoardRunner: ai.boardRunner || '',
      assistBoardConf2: ai.boardConf2 || 0,
      assistLowConf: !!ai.lowConf,
      assistState: ai.prefilled ? 'prefilled' : 'idle'
    })
    this._assistUsed = !!ai.used
    // 条目内容已上页面：从草稿箱移除（下次保存会以新条目回来，不会重复堆积）
    try { wx.removeStorageSync(key) } catch (e) { /* */ }
    // 跨会话恢复：本地临时路径可能已失效，有 fileId 的图后台换新临时链接
    if (media.some(m => m.fileId)) this._refreshDraftMedia()
  },

  /** 草稿恢复后的图片链接续命：fileId → 新临时 URL（fire-and-forget） */
  async _refreshDraftMedia() {
    try {
      const items = this.data.media.filter(m => m.fileId)
      if (!items.length) return
      const map = await getTempUrls(items.map(m => m.fileId))
      const patch = {}
      for (const m of items) {
        const url = map[m.fileId]
        const i = this.data.media.indexOf(m)
        if (url && i > -1) patch['media[' + i + '].localPath'] = url
      }
      if (Object.keys(patch).length) this.setData(patch)
    } catch (e) { /* 静默，展示失败不影响编辑 */ }
  },

  /** 发布成功：只从草稿箱移除与刚发布内容一致的条目，其余历史草稿保留 */
  clearDraft() {
    try {
      const snap = this._snapshot()
      const sig = JSON.stringify([
        snap.title, snap.content, snap.link, snap.fields,
        snap.media.map(m => [m.localPath, m.fileId, m.uploaded])
      ])
      const keys = (wx.getStorageInfoSync().keys || []).filter(k => k.indexOf(DRAFT_KEY) === 0)
      for (const k of keys) {
        let d = null
        try { d = wx.getStorageSync(k) } catch (e) { d = null }
        if (d && d.sig === sig) { try { wx.removeStorageSync(k) } catch (err) { /* */ } }
      }
    } catch (e) { /* */ }
  },

  // ---------- 草稿箱（发布按钮旁入口，追加式条目列表，旧草稿永不覆盖） ----------
  onDraftBox() {
    // 先把当前编辑状态存好再打开，抽屉里的数据才是最新的
    if (!this._submitted) this.saveDraft()
    this.setData({ draftBoxShow: true, draftList: this._buildDraftList() })
  },

  onDraftClose() {
    this.setData({ draftBoxShow: false })
  },

  _buildDraftList() {
    let keys = []
    try {
      keys = (wx.getStorageInfoSync().keys || []).filter(k => k.indexOf(DRAFT_KEY) === 0)
    } catch (e) { return [] }
    const out = []
    for (const k of keys) {
      let d = null
      try { d = wx.getStorageSync(k) } catch (e) { continue }
      if (!d) continue
      // 新格式：草稿对象自带 board；旧格式（按板块键存储）从 key 后缀推断
      let board = d.board
      if (BOARD_KEYS.indexOf(board) < 0) {
        const suffix = k.slice(DRAFT_KEY.length)
        if (BOARD_KEYS.indexOf(suffix) >= 0) board = suffix
      }
      if (!board) continue
      const count = (d.media && d.media.length) || 0
      const thumb = (d.media && d.media.length && d.media[0].localPath) || ''
      out.push({
        key: k,
        board,
        label: BOARDS[board].label,
        color: BOARDS[board].color,
        title: d.title || (d.content ? clipChars(d.content, 22) : (count ? '[图片]' : '未命名草稿')),
        count,
        thumb,
        at: d.at || 0,
        atText: fmtWhen(d.at)
      })
    }
    return out.sort((a, b) => b.at - a.at)
  },

  onDraftTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ draftBoxShow: false })
    this.restoreDraft(key, e.currentTarget.dataset.board)
  },

  onDraftDel(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    wx.showModal({
      title: '删除草稿',
      content: '确定删除这条草稿吗？删除后不可恢复。',
      confirmText: '删除',
      success: res => {
        if (!res.confirm) return
        try { wx.removeStorageSync(key) } catch (err) { /* */ }
        this.setData({ draftList: this._buildDraftList() })
      }
    })
  },

  /** 一键回到空白发布页：标题/正文/字段/图片/AI 状态全清（板块不变）。
      清空前先把当前内容存进草稿箱，可随时找回。 */
  onResetAll() {
    if (this.data.submitting) return
    if (this.data.assistState === 'analyzing') {
      // 分析中：作废进行中的 AI 请求再清
      this._assistSeq++
    }
    if (!this.hasDraft() && this.data.assistState !== 'prefilled') return toast('已经是空的啦')
    wx.showModal({
      title: '清空重写',
      content: '当前内容会存入草稿箱，页面恢复空白，确定吗？',
      confirmText: '清空',
      success: res => {
        if (!res.confirm) return
        this.saveDraft()          // 内容进草稿箱，可找回
        this._assistSeq++         // 迟到结果作废
        this.clearAssistTimers()
        this._assistUsed = false
        this._assistFileId = ''
        this.setData({
          title: '', content: '', link: '',
          fields: {}, titleCount: 0, contentCount: 0,
          fieldList: BOARDS[this.data.board].fields.map(f => ({ ...f, value: '' })),
          media: [], mediaType: 'none',
          assistState: 'idle', assistPhoto: '', assistSuggest: null,
          assistBoardTop: '', assistBoardConf: 0,
          assistBoardRunner: '', assistBoardConf2: 0,
          assistLowConf: false, assistFieldKey: '',
          aiMarks: { title: false, content: false, field: false }
        })
        this.logAssist('reset_all')
        toast('已恢复空白，内容在草稿箱里')
      }
    })
  },

  // ---------- 输入（用户开始编辑 = ✦ 责任移交完成） ----------
  onTitle(e) {
    const v = e.detail.value
    const n = countChars(v)
    if (n > LIMITS.titleMax) {
      // ⚠️ 不能直接 return：那会让输入框里显示的字和 data.title 不一致
      //    （用户看到超了字，但计数器停在上限、提交时又被服务端拒）
      //    截断到上限并提示，让输入框与 data 保持一致。
      //    截断要用 Array.from（与 countChars 同口径，按 code point 计），
      //    直接 slice 会把 emoji 劈成乱码。
      toast(`标题最多 ${LIMITS.titleMax} 字`)
      this.setData({ title: clipChars(v, LIMITS.titleMax), titleCount: LIMITS.titleMax })
      return
    }
    const patch = { title: v, titleCount: n }
    if (this.data.aiMarks.title) patch.aiMarks = { ...this.data.aiMarks, title: false }
    this.setData(patch)
    this.logAssist('prefilled_edit', { field: 'title' })
  },

  onContent(e) {
    const v = e.detail.value
    const n = countChars(v)
    if (n > LIMITS.contentMax) {
      toast(`正文最多 ${LIMITS.contentMax} 字`)
      this.setData({ content: clipChars(v, LIMITS.contentMax), contentCount: LIMITS.contentMax })
      return
    }
    const patch = { content: v, contentCount: n }
    if (this.data.aiMarks.content) patch.aiMarks = { ...this.data.aiMarks, content: false }
    this.setData(patch)
    this.logAssist('prefilled_edit', { field: 'content' })
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
    const patch = { fields, fieldList }
    // AI 预填的那个字段被编辑 → ✦ 移除
    if (key === this.data.assistFieldKey && this.data.aiMarks.field) {
      patch.aiMarks = { ...this.data.aiMarks, field: false }
    }
    this.setData(patch)
    this.logAssist('prefilled_edit', { field: key })
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
    const tap = await new Promise(resolve => {
      wx.showActionSheet({
        itemList: ['拍摄', '从相册选择'],
        success: res => resolve(res.tapIndex),
        fail: () => resolve(-1)
      })
    })
    if (tap === 0) {
      this._cameraIntent = 'add'
      return this.setData({ cameraShow: true })
    }
    if (tap === 1) {
      try {
        const items = await chooseImages(remain)
        this._appendImages(items)
      } catch (e) { /* 用户取消 */ }
    }
    /* 用户取消 */
  },

  /** 批量追加图片到 media（lid 用作 wx:key，删除中间项后 index 漂移会复用错位） */
  _appendImages(items) {
    const remain = LIMITS.maxImages - this.data.media.length
    if (remain <= 0) return toast(`最多 ${LIMITS.maxImages} 张图`)
    const add = (items || []).slice(0, remain).map(it => ({
      lid: randId(8),
      type: 'image', localPath: it.localPath, size: it.size, w: it.w, h: it.h,
      uploaded: false, fileId: '', progress: 0
    }))
    if (!add.length) return
    this.setData({ media: this.data.media.concat(add), mediaType: 'image' })
  },

  async onAddVideo() {
    if (this.data.submitting) return
    if (this.data.mediaType === 'image') {
      return toast('图与视频只能选一种，先删除图片')
    }
    try {
      const items = await chooseVideo()
      this.setData({
        media: items.map(it => ({ lid: randId(8), type: 'video', localPath: it.localPath, thumb: it.thumb, size: it.size, duration: it.duration, uploaded: false, fileId: '', progress: 0 })),
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

  // =========================================================
  // 拍照即发帖（9.22）：状态机 idle → shooting → analyzing → prefilled → submitted
  // 核心原则：AI 只建议不接管。失败照片原位保留，回手动流程零惩罚。
  // =========================================================

  // ---------- 屏 01 · AI 入口卡 ----------
  onAssistEntry() {
    if (!this.data.assistAvailable || this.data.submitting) return
    if (this.data.assistState !== 'idle') return
    // 已填内容不丢：AI 只补建议（照常进入，只提示不打断）
    if (this.hasDraft()) toast('已填的内容不会丢，AI 只补建议')
    this.logAssist('assist_entry_click')
    this.setData({ assistState: 'shooting' })
  },

  onAssistCancel() {
    this.setData({ assistState: 'idle' })
  },

  // 半屏弹层阻止冒泡（点遮罩才关闭）
  stopBubble() {},

  // ---------- 屏 02 · 选照片（拍照 / 相册，单选） ----------
  async onAssistCamera() { this.assistPick('camera') },
  async onAssistAlbum() { this.assistPick('album') },

  async assistPick(sourceType) {
    if (this.data.assistState !== 'shooting') return
    if (this.data.mediaType === 'video') {
      toast('已选了视频，先删除才能换图片')
      return this.setData({ assistState: 'idle' })
    }
    if (this.data.media.length >= LIMITS.maxImages) {
      toast(`最多 ${LIMITS.maxImages} 张图`)
      return this.setData({ assistState: 'idle' })
    }
    if (sourceType === 'camera') {
      // wx.chooseMedia 拍照会强制存入系统相册（平台行为，无参数可关）；
      // 自拍相机用 camera 组件 takePhoto，只出临时文件不落相册
      this._cameraIntent = 'assist'
      return this.setData({ cameraShow: true })
    }
    let item
    try {
      item = await chooseSingleImage('album')
    } catch (e) {
      // 用户取消选图：回到 idle（半屏已关），无任何副作用
      return this.setData({ assistState: 'idle' })
    }
    this._assistProceed(item)
  },

  /** 拿到照片（相册选或自拍）→ 进入分析流程 */
  _assistProceed(item) {
    // 照片先挂进 media 数组（fail 降级时原位保留，提交时统一走 uploadAllMedia）
    const rec = {
      lid: randId(8), type: 'image',
      localPath: item.localPath, size: item.size || 0, w: item.w || 0, h: item.h || 0,
      uploaded: false, fileId: '', progress: 0
    }
    const media = this.data.media.concat([rec])
    this.setData({
      media, mediaType: 'image',
      assistState: 'analyzing',
      assistPhoto: item.localPath,
      assistPhaseText: ASSIST_PHASES[0]
    })
    this.startAssistAnim()
    this.runAssist(rec, media.length - 1)
  },

  // ---------- 自拍相机浮层（camera 组件：takePhoto 不进系统相册） ----------
  onCameraClose() {
    // 拍照取消：识图流程回 idle（半屏选图已关）
    if (this._cameraIntent === 'assist') this.setData({ cameraShow: false, assistState: 'idle' })
    else this.setData({ cameraShow: false })
  },

  onCameraError() {
    this.setData({ cameraShow: false, assistState: 'idle' })
    wx.showModal({
      title: '相机不可用',
      content: '需要使用相机拍照，请在设置中开启权限后重试',
      confirmText: '去设置',
      success: res => { if (res.confirm) wx.openSetting({}) }
    })
  },

  async onShutter() {
    if (this._shooting) return
    this._shooting = true
    try {
      const res = await new Promise((resolve, reject) => {
        wx.createCameraContext().takePhoto({ quality: 'high', success: resolve, fail: reject })
      })
      this.setData({ cameraShow: false })
      // takePhoto 只给临时路径：补齐 size/w/h，与 chooseMedia 返回结构对齐
      const item = await this._photoRecord(res.tempImagePath)
      if (this._cameraIntent === 'assist') {
        this._assistProceed(item)
      } else {
        this._appendImages([item])
      }
    } catch (e) {
      toast('没拍到，再试一次')
    } finally {
      this._shooting = false
    }
  },

  _photoRecord(path) {
    return new Promise(resolve => {
      wx.getImageInfo({
        src: path,
        success: info => {
          wx.getFileInfo({
            filePath: path,
            success: f => resolve({ type: 'image', localPath: path, size: f.size, w: info.width, h: info.height }),
            fail: () => resolve({ type: 'image', localPath: path, size: 0, w: info.width, h: info.height })
          })
        },
        fail: () => resolve({ type: 'image', localPath: path, size: 0, w: 0, h: 0 })
      })
    })
  },

  // ---------- 屏 03 · AI 分析中（扫描光 + 文案轮换 + 12s 兜底） ----------
  startAssistAnim() {
    this.clearAssistTimers()
    let phase = 0
    this._phaseTimer = setInterval(() => {
      phase = (phase + 1) % ASSIST_PHASES.length
      this.setData({ assistPhaseText: ASSIST_PHASES[phase] })
    }, ASSIST_PHASE_MS)
    // 12s 前端兜底：超时即降级；迟到结果靠 _assistSeq 失效被静默丢弃
    this._assistTimer = setTimeout(() => this.assistFail('超时'), ASSIST_TIMEOUT_MS)
  },

  clearAssistTimers() {
    if (this._phaseTimer) { clearInterval(this._phaseTimer); this._phaseTimer = null }
    if (this._assistTimer) { clearTimeout(this._assistTimer); this._assistTimer = null }
  },

  /** 用户主动放弃等待 → 切回手动（已完成的部分保留，照片已在 media） */
  onAssistGiveUp() {
    this._assistSeq++ // 迟到结果作废
    this.clearAssistTimers()
    toast('已完成的部分会保留')
    this.setData({ assistState: 'idle' })
  },

  /** 降级零惩罚：toast + 回 idle，照片原位保留可直接手动编辑 */
  assistFail(reason) {
    this._assistSeq++
    this.clearAssistTimers()
    this.logAssist('analyze_fail', { reason })
    toast('AI 开小差了，已切回手动填写')
    this.setData({ assistState: 'idle' })
  },

  /** 分析主链路：压缩上传（展示图 + 送审图）→ postAssist（幂等）→ 应用建议 */
  async runAssist(mediaRec, mediaIdx) {
    const mySeq = ++this._assistSeq
    if (!this._uid) this._uid = getUid() || 'u'
    try {
      // 上传：复用 utils/media.js 压缩链路（≤1MB 再上传，送审图 750 宽）
      const rec = await uploadImage(mediaRec, this._uid)
      // 上传期间用户可能已取消/超时（seq 失效）→ 静默终止
      if (mySeq !== this._assistSeq) return
      this._assistFileId = rec.fileId
      this.setData({
        [`media[${mediaIdx}].uploaded`]: true,
        [`media[${mediaIdx}].fileId`]: rec.fileId,
        [`media[${mediaIdx}].progress`]: 100
      })
      // 内容安全与频控由服务端把关（imgSecCheck 先行，不合规不消耗模型调用）
      const result = await api.postAssist(rec.fileId, randId(24))
      if (mySeq !== this._assistSeq) return // 迟到结果静默丢弃
      this.applySuggest(result)
    } catch (e) {
      if (mySeq !== this._assistSeq) return
      if (e && e.code === 40010) {
        // 图片不合规：红条提示 + 移除这张图，停留在选图步（屏 02）
        this.clearAssistTimers()
        toast('这张照片过不了内容检测，换一张试试')
        const media = this.data.media.filter(m => m !== mediaRec)
        this.setData({ media, mediaType: media.length ? this.data.mediaType : 'none', assistState: 'shooting' })
        return
      }
      if (e && e.code === 42902) {
        // 当日 3 次用完：toast 后回手动（下次进入入口卡仍可用，服务端兜底）
        this.clearAssistTimers()
        toast('今天的使用次数用完了，明天再来，AI 也要休息')
        return this.setData({ assistState: 'idle' })
      }
      // 其余异常（含 12s 内的接口失败）：降级回手动
      this.assistFail((e && e.msg) || '接口异常')
    }
  },

  // ---------- 屏 04 · 预填确认（核心屏）：建议落表单，✦ 标记来源 ----------
  applySuggest(result) {
    if (!result) return this.assistFail('空结果')
    this._assistUsed = true
    this.clearAssistTimers()
    const conf = Number(result.confidence) || 0
    this.logAssist('analyze_done', { conf, board: result.board && result.board.top })
    const marks = { ...this.data.aiMarks }
    const patch = {
      assistState: 'prefilled',
      assistSuggest: result,
      assistLowConf: conf < ASSIST_CONF_LOW,
      aiMarks: marks
    }

    // 板块建议：只展示，不自动切换（胶囊手动点选永远优先）
    if (result.board && result.board.top) {
      patch.assistBoardTop = result.board.top
      patch.assistBoardConf = Math.round((Number(result.board.conf) || 0) * 100)
      patch.assistBoardRunner = result.board.runnerUp || ''
      patch.assistBoardConf2 = Math.round((Number(result.board.conf2) || 0) * 100)
    }

    // 「AI 只填空、从不覆盖用户输入」；「换个写法」时也可覆盖仍带 ✦ 的 AI 字段
    const canFill = (cur, marked) => !cur || marked
    if (canFill(this.data.title.trim(), marks.title) && result.title) {
      patch.title = result.title
      patch.titleCount = countChars(result.title)
      marks.title = true
    }
    if (canFill(this.data.content.trim(), marks.content) && result.content) {
      patch.content = result.content
      patch.contentCount = countChars(result.content)
      marks.content = true
    }
    // 动态字段：只填第一个空字段（fields.shop 等）
    const emptyField = this.data.fieldList.find(f => !(this.data.fields[f.key] || '').trim())
    if (emptyField && result.fields) {
      const v = result.fields[emptyField.key]
      if (v) {
        patch.fields = { ...this.data.fields, [emptyField.key]: v }
        patch.fieldList = this.data.fieldList.map(f => f.key === emptyField.key ? { ...f, value: v } : f)
        patch.assistFieldKey = emptyField.key
        marks.field = true
      }
    }
    this.setData(patch)
  },

  // ---------- 屏 05 · 提交成功（AI 协作标注 + 去向按钮） ----------
  onAssistGoHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onAssistGoMine() {
    // 刚发的帖子通常在审核中：tab 直接落在 pending，状态一眼可见
    wx.navigateTo({ url: '/pages/me/posts/posts?tab=pending' })
  },

  /** 「换个写法」：仅标题与正文重新生成，可反复换（总量受服务端每日频控约束）；
      用户改过的字段不被覆盖（canFill：只覆盖仍带 ✦ 的 AI 字段） */
  async onAssistRegen() {
    if (this.data.assistState !== 'prefilled') return
    if (!this._assistFileId) return toast('照片还没上传成功，先手动改一改吧')
    this.logAssist('regen_click')
    this.setData({ assistState: 'analyzing', assistPhaseText: ASSIST_PHASES[1] })
    this.startAssistAnim()
    // 复用已上传的 fileId，不再重传
    const mySeq = ++this._assistSeq
    try {
      const result = await api.postAssist(this._assistFileId, randId(24))
      if (mySeq !== this._assistSeq) return
      this.applySuggest(result)
    } catch (e) {
      if (mySeq !== this._assistSeq) return
      if (e && e.code === 42902) {
        this.clearAssistTimers()
        toast('今天的使用次数用完了，明天再来，AI 也要休息')
        return this.setData({ assistState: 'prefilled' })
      }
      this.assistFail((e && e.msg) || '接口异常')
    }
  },

  /** 埋点（fire-and-forget）：assist_* 事件反哺 prompt（9.24 契约：type=api，事件名入 message） */
  logAssist(event, payload) {
    api.clientLog('api', event, payload || {}, 'pages/post/create/create')
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
    // 只在允许链接的板块校验链接格式
    if (this.data.allowLink && this.data.link && !validLink(this.data.link)) return '链接格式不正确'
    return ''
  },

  async onSubmit() {
    if (this.data.submitting) return
    if (this.data.assistState === 'analyzing') {
      // 分析中不允许发布：字段还没稳定（用户可先切回手动再发布）
      return toast('AI 正在分析，稍等或点「切回手动填写」')
    }
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
      // ⚠️ 只有生活板块提供链接输入 —— 学习/美食板块不带 link 上行
      if (this.data.allowLink && this.data.link) fields.link = this.data.link
      const res = await api.postCreate({
        board: this.data.board,
        title: normalizeText(this.data.title),
        content: cleanContent(this.data.content),
        fields,
        media,
        // 拍照即发帖：AI 参与过创作 → 打 aiAssist 标（审核台 ✦ 知情权，契约零改动的新增可选字段）
        aiAssist: this._assistUsed === true,
        clientReqId: this._clientReqId
      })
      this._submitted = true
      this.clearDraft()
      wx.hideLoading()
      getApp().globalData.feedDirty = true
      if (this._assistUsed) {
        // 屏 05 · 成功页：闭环告知 + AI 协作标注 + 帖子预览（替代 toast 返回）
        const firstImg = this.data.media.find(m => m.type === 'image')
        this.setData({
          assistState: 'submitted',
          submitStatus: (res && res.status) || 'published',
          assistPreviewCover: firstImg ? firstImg.localPath : ''
        })
      } else if (res && res.status === 'pending') {
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

  onBack() {
    // 成功页里「取消」等于回首页（表单已清、不再走草稿）
    if (this.data.assistState === 'submitted') return this.onAssistGoHome()
    wx.navigateBack()
  },

  onRetry() { /* 预留 */ }
})
