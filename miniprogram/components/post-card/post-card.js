// 信息流帖子卡：封面 + 圆体标题 + 摘要 + 匿名 meta + 赞/藏
// 兼容两种数据源：
//  - postList / meList(favorites) → postBrief（含 likeCount/favCount/liked/faved/mediaType/expired）
//  - meList(posts) → 精简项（仅 title/excerpt/cover/status/citedCount）
const { timeAgo, countShort } = require('../../utils/format')

Component({
  properties: {
    post: { type: Object, value: {} },
    showBoard: { type: Boolean, value: false },
    showFav: { type: Boolean, value: true },
    manageable: { type: String, value: '' }   // 'manage' 时展示删除/下线操作
  },
  data: {
    timeText: '',
    likeText: '0',
    favText: '0',
    statusText: ''
  },
  observers: {
    post(p) {
      if (!p || !p.id) return
      this.setData({
        timeText: timeAgo(p.createdAt),
        likeText: countShort(p.likeCount),
        favText: countShort(p.favCount),
        // 状态角标仅在管理态（我的分享）显示：首页/收藏流的帖子 status 恒为
        // published，显示「已发布」没有信息量，且绝对定位会压住标题首字
        statusText: p.manageable ? this.statusText(p.status) : ''
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
    }
  }
})
