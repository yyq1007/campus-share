// S6 我的：头像昵称卡 + 数据统计 + 菜单（我的分享/收藏/消息/审核台/关于）+ 角色入口
const api = require('../../utils/api')
const { toast } = require('../../utils/cloud')
const { guard, getUid, clearLogin } = require('../../utils/auth')
const { uploadAvatar, getTempUrls } = require('../../utils/media')

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    profile: null,          // { nickname, avatarUrl, role, stats:{posts,favs,cited}, unread, pendingCount }
    isAdmin: false,
    state: 'loading'
  },

  onLoad() {
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    this.load()
  },

  async load() {
    this.setData({ state: this.data.profile ? 'success' : 'loading' })
    try {
      await guard()
      const res = await api.meOverview()
      // avatar 为 {fileId,status} 对象，需换成可展示的临时链接
      const avatarUrl = await this.resolveAvatar(res.avatar)
      this.setData({
        profile: {
          ...res,
          avatarUrl,
          nick: res.nickname || '',
          stats: res.stats || { posts: 0, favs: 0, cited: 0 }
        },
        isAdmin: res.role === 'admin' || res.role === 'reviewer',
        state: 'success'
      })
    } catch (e) {
      if (e && e.silent) return
      if (!this.data.profile) this.setData({ state: 'error' })
    }
  },

  /** avatar 字段 → https 临时链接 */
  async resolveAvatar(avatar) {
    const fileId = avatar && typeof avatar === 'object' ? avatar.fileId : avatar
    if (!fileId) return ''
    if (avatar && avatar.status === 'risky') return ''
    try {
      const map = await getTempUrls([fileId])
      return map[fileId] || ''
    } catch (e) {
      return ''
    }
  },

  // ---------- 头像 ----------
  async onAvatarTap() {
    try {
      const res = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['compressed'],
          success: resolve,
          fail: reject
        })
      })
      const file = res.tempFiles[0]
      // 正方形框选裁剪（基础库 2.26.0+ 系统裁剪界面，用户可拖动框选区域）；低版本直接用原图
      let src = file.tempFilePath
      if (wx.cropImage) {
        try {
          const crop = await new Promise((resolve, reject) => {
            wx.cropImage({
              src,
              cropScale: '1:1',
              success: resolve,
              fail: reject
            })
          })
          if (crop && crop.tempFilePath) src = crop.tempFilePath
        } catch (e) { /* 用户取消裁剪或能力不可用 → 用原图 */ }
      }
      wx.showLoading({ title: '上传中…', mask: true })
      const uid = getUid() || 'u'
      const fileId = await uploadAvatar(src, uid)
      const r = await api.updateAvatar(fileId)
      const avatarUrl = await this.resolveAvatar(r && r.avatar ? r.avatar : { fileId })
      wx.hideLoading()
      this.setData({ 'profile.avatarUrl': avatarUrl })
      toast('头像已更新')
    } catch (e) {
      wx.hideLoading()
      if (e && e.errMsg && (e.errMsg.indexOf('chooseMedia:fail cancel') >= 0 || e.errMsg.indexOf('cropImage:fail cancel') >= 0)) return
      toast((e && e.msg) || '更换失败')
    }
  },

  // ---------- 菜单 ----------
  onMyPosts() { wx.navigateTo({ url: '/pages/me/posts/posts' }) },
  onMyFavs() { wx.navigateTo({ url: '/pages/me/favorites/favorites' }) },
  onMessages() { wx.navigateTo({ url: '/pages/me/messages/messages' }) },
  onAdmin() { wx.navigateTo({ url: '/pkg-admin/admin/admin' }) },
  onAbout() { wx.navigateTo({ url: '/pages/about/about' }) },
  onSearch() { wx.navigateTo({ url: '/pages/search/search' }) },

  // 被引用：跳到我的分享（被引用的帖在列表里带「被 AI 引用」标记）
  onCited() { wx.navigateTo({ url: '/pages/me/posts/posts' }) },

  // ---------- 退出登录 ----------
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新用邀请码进入，确定退出吗？',
      confirmText: '退出',
      confirmColor: '#D64556',
      success: async r => {
        if (!r.confirm) return
        clearLogin()
        wx.reLaunch({ url: '/pages/auth/invite/invite' })
      }
    })
  },

  onRetry() { this.load() }
})
