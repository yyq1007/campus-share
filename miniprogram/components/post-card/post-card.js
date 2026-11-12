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
    // 封面区高度（占卡片宽度的百分比）：默认 4:3；post.coverW/H 有值就直接用，
    // 没有（老帖子）再等图片 onload 按真实比例覆盖
    coverRatio: 75
  },
  observers: {
    // ⚠️ 必须同时监听 manageable：它是控制角标显不显示的开关，
    //    只监听 post 的话，post 先到、manageable 后设就永远不触发重算
    post(p) {
      if (!p || !p.id) return
      // 周报卡：不是真帖子，没有赞/藏/状态角标
      if (p.isDigest) {
        this.setData({ timeText: '', likeText: '', favText: '', commentText: '', statusText: '' })
        return
      }
      const b = BOARDS[p.board]
      // 封面换了（列表复用同一条记录）：按新帖的宽高重算，避免沿用上一条的比例。
      // coverW/H 由 postList 下发，图片还没加载就能算准，不会先 75% 再跳一下。
      let ratioPatch = null
      if (this._lastCover !== p.cover) {
        this._lastCover = p.cover
        ratioPatch = { coverRatio: this.ratioOf(p.coverW, p.coverH, p.mediaType) }
      }
      this.setData({
        ...(ratioPatch || {}),
        timeText: timeAgo(p.createdAt),
        likeText: countShort(p.likeCount),
        favText: countShort(p.favCount),
        commentText: countShort(p.commentCount),
        // 匿名头像：按帖子 id 取糖果色（不按作者，避免用颜色重建作者画像）
        avatarIdx: avatarIndex(p.id),
        boardLabel: b ? b.label : '',
        boardSticker: (b && b.sticker) || 'sticker-lamp',
        // 状态角标仅在管理态（我的分享）显示：首页/收藏流的帖子 status 恒为
        // published，显示「已发布」没有信息量
        // ⚠️ 用 this.data.manageable（组件自身的 prop），
        //    不能用 p.manageable —— 帖子对象上没有这个字段，恒为 undefined
        statusText: this.data.manageable ? this.statusText(p.status) : ''
      })
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
    },

    /**
     * 宽高 → 占位高度百分比（相对卡片宽度）。
     * 区间说明：56%（16:9 横图）~ 140%（接近 3:4 竖图）之内都是精确比例，
     * aspectFill 一个像素都不裁；只有极端长截图/全景图才被压在边界上。
     * 之前上限 118% 会把常见的 3:4 竖图裁掉一截，看着就像「图片大小不对」。
     */
    ratioOf(w, h, mediaType) {
      if (!w || !h) return mediaType === 'video' ? 56 : 75
      return Math.min(Math.max(Math.round((h / w) * 100), 56), 140)
    },

    /**
     * 封面图加载完 → 按真实宽高比兜底（老帖子没有 coverW/H 时走这条）。
     * 上下限与 ratioOf 保持一致。
     */
    onCoverLoad(e) {
      const d = e.detail || {}
      const w = d.width || 0
      const h = d.height || 0
      if (!w || !h) return
      const ratio = this.ratioOf(w, h)
      if (ratio !== this.data.coverRatio) this.setData({ coverRatio: ratio })
    }
  }
})
