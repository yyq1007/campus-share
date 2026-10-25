// app.js —— 全局：字体预加载、导航高度、Mock 数据
App({
  globalData: {
    navBarHeight: 44,      // 自定义导航总高（px）
    statusBarHeight: 20,
    capsuleRight: 100,     // 胶囊右缘到屏幕右缘的距离
    fontReady: false,
    draft: null,           // 发帖草稿跨页传递
    pendingAsk: ''         // 从首页带入 AI 问答的问题
  },

  onLaunch() {
    // 1) 状态栏 + 胶囊，动态算自定义导航高度（避开幕右侧胶囊）
    try {
      const ws = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const st = ws.statusBarHeight || 20;
      const cap = wx.getMenuButtonBoundingClientRect();
      const navH = (cap.top - st) * 2 + cap.height;
      this.globalData.statusBarHeight = st;
      this.globalData.navBarHeight = navH;
      this.globalData.capsuleRight = (ws.windowWidth || ws.screenWidth) - cap.right;
    } catch (e) { /* 兜底默认 */ }

    // 2) 标题圆体子集化加载（失败降级系统 600，见 MVP 文档 C-15）
    this.loadTitleFont();
  },

  loadTitleFont() {
    const FONT_URL = 'https://your-cdn.example.com/fonts/zcool-kuaile-subset.woff2';
    wx.loadFontFace({
      family: 'KuaiLe',
      source: `url("${FONT_URL}")`,
      desc: { weight: '600', style: 'normal' },
      global: true,
      success: () => { this.globalData.fontReady = true; },
      fail: () => { this.globalData.fontReady = false; }  // 降级：不阻断
    });
  },

  // —— Mock：首页信息流（真实由 postList 云函数返回） ——
  mockPosts() {
    return [
      { id: 'p1', board: 'life',  boardName: '生活', title: '盗月社同款麻辣烫，踩雷实录',
        body: '其实味道还行，就是排队太久，工作日中午去都排了 40 分钟，建议大家错峰。',
        imgs: ['#E3F7F5', '#FFECEF', '#E7F1FF'], time: '3天前', like: 12, fav: 3, comment: 3, expired: true },
      { id: 'p2', board: 'study', boardName: '学习', title: '高数期末抱佛脚指南',
        body: '把近三年真题按题型拆开刷，计算题每天 2 套，最后三天只背公式卡。',
        imgs: ['#E7F1FF'], time: '1天前', like: 28, fav: 9, comment: 5, expired: false },
      { id: 'p3', board: 'food',  boardName: '美食', title: '宿舍楼下新开的炸鸡，
        闭眼冲', body: '蒜香无骨鸡柳绝了，15 块一大份，一个人吃撑。', imgs: [],
        time: '5小时前', like: 6, fav: 1, comment: 0, expired: false }
    ];
  }
});
