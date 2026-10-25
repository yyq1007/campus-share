// 四态组件：loading（骨架）/ empty / error / offline
// styleIsolation=apply-shared：骨架屏 .card 与按钮 .btn-primary/.btn-secondary
// 定义在 app.wxss 全局，isolated 隔离模式下不生效（按钮会变裸样式）
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    state: { type: String, value: 'loading' }, // loading|empty|error|offline|none
    type: { type: String, value: 'list' },     // 骨架类型 list|detail|chat
    icon: { type: String, value: 'empty-cat' },
    emptyText: { type: String, value: '还没有内容' },
    emptySub: { type: String, value: '' },
    btnText: { type: String, value: '' }
  },
  data: { slow: false },
  observers: {
    // 每次进入 loading 重新起 6s 计时：超时仍未加载完 → 显示慢加载提示与重试
    state(s) {
      clearTimeout(this._slowTimer)
      if (s === 'loading') {
        this.setData({ slow: false })
        this._slowTimer = setTimeout(() => this.setData({ slow: true }), 6000)
      } else {
        if (this.data.slow) this.setData({ slow: false })
      }
    }
  },
  lifetimes: {
    detached() { clearTimeout(this._slowTimer) }
  },
  methods: {
    onRetry() { this.triggerEvent('retry') },
    onAction() { this.triggerEvent('action') }
  }
})
