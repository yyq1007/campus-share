// 自定义导航：透明→白渐变（详情页沉浸），动态适配胶囊
Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false },
    transparent: { type: Boolean, value: false }, // 沉浸模式：随 scrollTop 渐显
    scrollTop: { type: Number, value: 0 },
    titleColor: { type: String, value: '' } // 覆盖标题色（transparent 未滚时用）
  },
  data: {
    statusBarH: 40,
    navH: 44,
    bgOpacity: 0,
    capsuleRight: 90
  },
  lifetimes: {
    attached() {
      this.compute()
    }
  },
  observers: {
    scrollTop() {
      // 0→80px 之间渐显（transparent 模式）
      const op = Math.min(1, (this.data.scrollTop || 0) / 80)
      this.setData({ bgOpacity: op })
    }
  },
  methods: {
    compute() {
      try {
        const win = wx.getWindowInfo()
        const cap = wx.getMenuButtonBoundingClientRect()
        const statusBarH = win.statusBarHeight || 40
        const navH = (cap.top - statusBarH) * 2 + cap.height
        const capsuleRight = cap.width + 12
        this.setData({ statusBarH, navH, capsuleRight })
      } catch (e) {
        this.setData({ statusBarH: 40, navH: 44, capsuleRight: 90 })
      }
    },
    onBack() {
      this.triggerEvent('back')
      const pages = getCurrentPages()
      if (pages.length === 1) {
        wx.reLaunch({ url: '/pages/index/index' })
      } else {
        wx.navigateBack()
      }
    }
  }
})
