// 信息流帖子卡（校园频道式）：头像 + 昵称/时间 → 标题/正文 → 图片 → 话题 → 赞·评论·收藏
// 兼容两种数据源：
//  - postList / meList(favorites) → postBrief（含 likeCount/favCount/commentCount/liked/faved/mediaType/expired）
//  - meList(posts) → 精简项（title/excerpt/cover/status/citedCount + 点赞收藏状态与计数）
const { timeAgo, countShort, avatarIndex } = require('../../utils/format')
const { BOARDS } = require('../../utils/config')

Component({
  properties: {
    post: { type: Object, value: {} },
    showBoard: { type: Boolean, value: true },  // 话题胶囊（板块名），默认展示
    showFav: { type: Boolean, value: true },
    showCited: { type: Boolean, value: false }, // 显示「被 AI 引用 N 次」
    // 双列网格模式（首页信息流用）：方形图区 + 标题 + 互动底栏，不放摘要和作者行
    grid: { type: Boolean, value: false },
    manageable: { type: String, value: '' }   // 'manage' 时展示删除/下线操作
  },
  data: {
    timeText: '',
    likeText: '0',
    favText: '0',
    commentText: '0',
    statusText: '',
    boardLabel: '',
    boardSticker: 'sticker-lamp',
    avatarIdx: 1,
    // v5：底栏右侧的作者署名（头像行已移到底栏，不再占卡首）
    authorText: '',
    // 点赞跳动爱心：仅在「点赞瞬间」为 true，动画播完置回 false，
    // 保证连续两次点赞（取消 → 再赞）都能重新触发动画
    likeBeat: false,
    // 收藏星标跳动（同 likeBeat 的重置思路）
    favBeat: false
  },
  observers: {
    // ⚠️ 必须同时监听 manageable：它是控制角标显不显示的开关，
    //    只监听 post 的话，post 先到、manageable 后设就永远不触发重算
    post(p) {
      if (!p || !p.id) return
      // 周报卡：不是真帖子，没有赞/藏/状态角标
      if (p.isDigest) {
        this.setData({ timeText: '', likeText: '', favText: '', commentText: '', statusText: '', authorText: '' })
        return
      }
      const b = BOARDS[p.board]
      this.setData({
        timeText: timeAgo(p.createdAt),
        likeText: countShort(p.likeCount),
        favText: countShort(p.favCount),
        commentText: countShort(p.commentCount),
        // 匿名头像：按帖子 id 取糖果色（不按作者，避免用颜色重建作者画像）
        avatarIdx: avatarIndex(p.id),
        // v5：作者署名进底栏（未设昵称回退「匿名同学」）
        authorText: (p.author && p.author.nickname) ? p.author.nickname : '匿名同学',
        boardLabel: b ? b.label : '',
        boardSticker: (b && b.sticker) || 'sticker-lamp',
        // 状态角标仅在管理态（我的分享）显示：首页/收藏流的帖子 status 恒为
        // published，显示「已发布」没有信息量
        // ⚠️ 用 this.data.manageable（组件自身的 prop），
        //    不能用 p.manageable —— 帖子对象上没有这个字段，恒为 undefined
        statusText: this.data.manageable ? this.statusText(p.status) : ''
      })
      this.detectLikeBeat(p)
      this.detectFavBeat(p)
    },
    manageable() {
      const p = this.data.post
      if (!p || !p.id || p.isDigest) return
      this.setData({
        statusText: this.data.manageable ? this.statusText(p.status) : ''
      })
    }
  },
  methods: {
    /**
     * 点赞瞬间 → 触发爱心跳动动画。
     * 只在 liked 由 false 变 true 时触发（取消点赞不跳）。
     * 靠 likeBeat 先置 true、动画时长后置 false 来重置 CSS 动画：
     * 若一直保持 true，连续「取消 → 再赞」第二次就不会再播。
     */
    detectLikeBeat(p) {
      const nowLiked = !!p.liked
      const wasLiked = !!this._prevLiked
      this._prevLiked = nowLiked
      if (!nowLiked || wasLiked) return
      if (this._beatTimer) clearTimeout(this._beatTimer)
      this.setData({ likeBeat: true })
      this._beatTimer = setTimeout(() => {
        this.setData({ likeBeat: false })
        this._beatTimer = null
      }, 600)
    },

    /**
     * 收藏瞬间 → 星标跳动。
     * 与 detectLikeBeat 同一套逻辑：只在 faved 由 false 变 true 时播，
     * 靠「置 true → 600ms 后置 false」让类被移除，下次才能重新触发。
     */
    detectFavBeat(p) {
      const nowFaved = !!p.faved
      const wasFaved = !!this._prevFaved
      this._prevFaved = nowFaved
      if (!nowFaved || wasFaved) return
      if (this._favTimer) clearTimeout(this._favTimer)
      this.setData({ favBeat: true })
      this._favTimer = setTimeout(() => {
        this.setData({ favBeat: false })
        this._favTimer = null
      }, 620)
    },

    /** 状态角标文案（仅「我的分享」有 status 字段） */
    statusText(s) {
      const map = {
        published: '已发布',
        pending: '审核中',
        rejected: '已驳回',
        hidden: '已下线',
        expired: '已过期'
      }
      return map[s] || ''
    },
    onTap() { this.triggerEvent('tap', { post: this.data.post }) },
    onLike(e) {
      this.triggerEvent('like', { post: this.data.post })
    },
    onFav() { this.triggerEvent('fav', { post: this.data.post }) },
    onDelete() { this.triggerEvent('delete', { post: this.data.post }) },
    onOffline() { this.triggerEvent('offline', { post: this.data.post }) },
    onPreview(e) {
      // 不冒泡到卡片点击
    }
  }
})
