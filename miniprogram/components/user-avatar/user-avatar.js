// 匿名头像：糖果色"匿"字按 uid 取模轮换；可选自定义照片头像 + 相机角标
const { avatarIndex } = require('../../utils/format')

Component({
  properties: {
    uid: { type: String, value: '' },
    avatar: { type: String, value: '' }, // 云文件 fileId，空则用默认
    size: { type: Number, value: 72 },   // rpx
    editable: { type: Boolean, value: false }
  },
  data: { idx: 1 },
  observers: {
    uid(v) { this.setData({ idx: avatarIndex(v) }) }
  },
  methods: {
    onTap() { this.triggerEvent('tap') }
  }
})
