// 状态标签：审核中 / 可能已过期 / 已隐藏 / 已驳回 / 仅你可见
Component({
  properties: {
    type: { type: String, value: 'pending' },
    text: { type: String, value: '' }
  },
  data: { map: {} },
  lifetimes: {
    attached() {
      this.setData({
        map: {
          pending: '审核中',
          expired: '可能已过期',
          hidden: '已隐藏',
          rejected: '已驳回',
          published: ''
        }
      })
    }
  }
})
