const app = getApp();
Page({
  data: { navBarHeight: 44, statusBarHeight: 20, posts: [] },
  onLoad() {
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      statusBarHeight: app.globalData.statusBarHeight,
      posts: app.mockPosts()
    });
  },
  goSearch()  { wx.navigateTo({ url: '/pages/search/search' }); },
  goAsk() {
    app.globalData.pendingAsk = '';
    wx.switchTab({ url: '/pages/ask/ask' });
  },
  goBoard(e)  { wx.navigateTo({ url: '/pages/board/board?board=' + e.currentTarget.dataset.board }); },
  goDetail(e) { wx.navigateTo({ url: '/pages/post/detail/detail?id=' + e.currentTarget.dataset.id }); },
  goCreate()  { wx.navigateTo({ url: '/pages/post/create/create' }); }
});
