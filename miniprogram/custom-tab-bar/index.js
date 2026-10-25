// 自定义 TabBar：首页 / 问答 / [发布] / 我的 —— 中间发布为凸起主色胶囊
Component({
  data: {
    selected: 0,
    list: [
      { key: 'index', path: '/pages/index/index', text: '首页', icon: 'tab-home', iconOn: 'tab-home-on' },
      { key: 'ask', path: '/pages/ask/ask', text: '问答', icon: 'tab-ask', iconOn: 'tab-ask-on' },
      { key: 'publish' },
      { key: 'profile', path: '/pages/profile/profile', text: '我的', icon: 'tab-me', iconOn: 'tab-me-on' }
    ]
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index
      const item = this.data.list[idx]
      if (item.key === 'publish') {
        wx.navigateTo({ url: '/pages/post/create/create' })
        return
      }
      wx.switchTab({ url: item.path })
    }
  }
})
