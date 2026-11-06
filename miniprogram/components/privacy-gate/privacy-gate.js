// 隐私协议门禁：首次进入（或版本更新后）以全屏遮罩要求阅读并同意
// 为什么不用 wx.showModal：
//   1) App.onLaunch 阶段尚无页面实例，页面级 API 会静默失败；
//   2) 首页 guard() 未绑邀请码时会 reLaunch 跳走，弹窗随之消失；
//   3) showModal 只能放一个链接，协议正文看不全。
// 组件形式随页面渲染，不依赖 onLaunch 时机；遮罩同时阻断未同意时的内容访问。
const { hasAgreed, markAgreed } = require('../../utils/privacy')

Component({
  data: {
    visible: false
  },
  lifetimes: {
    attached () {
      const app = getApp()
      // 告诉 App 层「门禁由组件接管」，避免 app 层再弹一次 modal。
      // 多个页面各挂一个 gate，用引用计数而不是布尔值 —— 返回上一页时
      // 旧页 detached 会把布尔标记清掉，导致 app 层重复弹窗。
      if (app && typeof app.acquirePrivacyGate === 'function') {
        app.acquirePrivacyGate()
      } else if (app) {
        app.privacyGateActive = true
      }
      this.setData({ visible: !hasAgreed() })
      // 订阅门禁状态广播：别处同意/拒绝后，本实例同步收起遮罩
      if (app && typeof app.onPrivacyStateChanged === 'function') {
        this._offPrivacy = app.onPrivacyStateChanged(() => {
          this.setData({ visible: !hasAgreed() })
        })
      }
    },
    detached () {
      const app = getApp()
      if (app && typeof app.releasePrivacyGate === 'function') {
        app.releasePrivacyGate()
      } else if (app) {
        app.privacyGateActive = false
      }
      if (typeof this._offPrivacy === 'function') this._offPrivacy()
      this._offPrivacy = null
    }
  },
  pageLifetimes: {
    show () {
      // 从协议页返回时同步状态（协议页同意后写缓存 → 这里要收起遮罩）
      const agreed = hasAgreed()
      if (agreed && this.data.visible) {
        this.setData({ visible: false })
      } else if (!agreed && !this.data.visible) {
        this.setData({ visible: true })
      }
    }
  },
  methods: {
    /** 去读两份协议正文 */
    onRead () {
      wx.navigateTo({
        url: '/pages/agreement/agreement?type=both',
        fail: () => {
          wx.showToast({ title: '请在「关于」页查看协议', icon: 'none' })
        }
      })
    },

    /** 直接同意：落缓存 + 放行被拦的隐私接口 */
    onAgree () {
      markAgreed()
      const app = getApp()
      if (app && typeof app.grantPrivacyAuthorization === 'function') {
        app.grantPrivacyAuthorization()
      }
      this.setData({ visible: false })
    },

    /**
     * 拒绝 = 不同意：关闭小程序。
     * 不落同意标记；真机上小程序直接关闭，开发者工具里退不出去，
     * 此时遮罩保持可见 —— 未同意的人一律进不去内容。
     */
    onDismiss () {
      const app = getApp()
      if (app && typeof app.__privacyReject === 'function') {
        app.__privacyReject()
        return
      }
      wx.exitMiniProgram({
        complete: () => {
          wx.showToast({ title: '需同意协议后才能使用', icon: 'none' })
        }
      })
    }
  }
})
