// 评论行：匿名 #N + 内容 + 时间 + 二级回复块（浅紫 + 左竖线）+ 展开更多
const { timeAgo } = require('../../utils/format')

Component({
  properties: {
    comment: { type: Object, value: {} },
    showReply: { type: Boolean, value: true }
  },
  data: { timeText: '', replyTimes: {} },
  observers: {
    comment(c) {
      if (!c || !c.id) return
      const replyTimes = {}
      for (const r of c.replies || []) replyTimes[r.id] = timeAgo(r.createdAt)
      this.setData({ timeText: timeAgo(c.createdAt), replyTimes })
    }
  },
  methods: {
    onReply() { this.triggerEvent('reply', { comment: this.data.comment }) },
    onExpand() { this.triggerEvent('expand', { comment: this.data.comment }) },
    onReplyItem(e) {
      const r = e.currentTarget.dataset.r
      this.triggerEvent('reply', { comment: this.data.comment, replyTo: r })
    },
    onLongPress() { this.triggerEvent('longpress', { comment: this.data.comment }) }
  }
})
