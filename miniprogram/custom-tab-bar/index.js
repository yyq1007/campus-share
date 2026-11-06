// 自定义 TabBar：首页 / 问答 / [发布] / 我的 —— 中间发布为凸起主色胶囊
// 隐私门禁：custom-tab-bar 由框架渲染在页面内容层之上，页面里的 privacy-gate
// 遮罩盖不住它。所以未同意协议时必须在这里单独拦一道：
//   1) 点任何 tab 都不跳转，只提示「请先同意协议」
//   2) 整条 bar 盖一层禁用遮罩，视觉上表明不可用
const { hasAgreed } = require('../utils/privacy')

Component({
  data: {
    selected: 0,
    locked: false,
    list: [
      { key: 'index', path: '/pages/index/index', text: '首页', icon: 'tab-home', iconOn: 'tab-home-on' },
      { key: 'ask', path: '/pages/ask/ask', text: '问答', icon: 'tab-ask', iconOn: 'tab-ask-on' },
      { key: 'publish' },
      { key: 'profile', path: '/pages/profile/profile', text: '我的', icon: 'tab-me', iconOn: 'tab-me-on' }
    ]
  },

  lifetimes: {
    attached () {
      this.syncLock()
    }
  },

  pageLifetimes: {
    show () {
      // 从协议页同意后返回：解除锁定
      this.syncLock()
    }
  },

  methods: {
    /** 同步锁定状态：未同意协议则整条 bar 不可用 */
    syncLock () {
      const locked = !hasAgreed()
      if (locked !== this.data.locked) this.setData({ locked })
    },

    switchTab(e) {
      // 未同意隐私协议：拦住所有跳转
      if (!hasAgreed()) {
        this.setData({ locked: true })
        wx.showToast({ title: '请先同意协议', icon: 'none' })
        return
      }
      const idx = e.currentTarget.dataset.index
      const item = this.data.list[idx]
      if (item.key === 'publish') {
        wx.navigateTo({ url: '/pages/post/create/create' })
        return
      }
      wx.switchTab({ url: item.path })
    },

    /** 点禁用遮罩：只提示，不跳转 */
    onLockTap () {
      wx.showToast({ title: '请先同意协议', icon: 'none' })
    }
  }
})
