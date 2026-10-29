// S5 AI 问答：只答站内 + 引用原帖卡 + 无候选引导发帖 + AIGC 声明 + 频控
// 频控/检索/生成均在 askQuery 云函数（P90 < 5s，前端 8s 兜底超时）
const api = require('../../utils/api')
const { toast } = require('../../utils/cloud')
const { guard } = require('../../utils/auth')
const { LIMITS } = require('../../utils/config')
const { countChars, randId } = require('../../utils/format')

const HISTORY_MAX = 20

Page({
  data: {
    statusBarH: 40,
    navH: 44,
    scrollInto: '',
    messages: [],
    question: '',
    asking: false,
    kbH: 0, // 键盘高度：输入条悬浮跟随，页面本体不再被顶起
    hotQuestions: ['食堂哪家窗口好吃？', '宿舍必备好物有哪些？', '有没有靠谱的考研资料？']
  },

  onLoad() {
    try {
      const win = wx.getWindowInfo()
      const cap = wx.getMenuButtonBoundingClientRect()
      const sb = win.statusBarHeight || 40
      this.setData({ statusBarH: sb, navH: (cap.top - sb) * 2 + cap.height })
    } catch (e) { /* 兜底 */ }
    // 量出输入条原位置距窗口底部的固定空隙（aigc-tip + 自定义 TabBar 预留区），
    // 键盘弹起时上浮量 = 键盘高度 - 该空隙，让输入条底边正好贴住键盘顶部
    wx.nextTick(() => {
      wx.createSelectorQuery().select('.input-bar').boundingClientRect(rect => {
        if (rect && wx.getWindowInfo) {
          const win = wx.getWindowInfo()
          this._kbLift = Math.max(0, Math.round(win.windowHeight - rect.bottom))
        }
      }).exec()
    })
    // 首条欢迎语
    this.pushMsg('ai', {
      text: '你好呀，我是本校分享问答助手～问我"食堂哪家好吃""宿舍必备什么"，我只基于站内同学的真实分享回答。'
    })
    // 首页 AI 引导卡跳转时自动聚焦
    if (getApp().globalData.focusAskInput) {
      getApp().globalData.focusAskInput = false
      this.setData({ inputFocus: true })
    }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  pushMsg(role, payload) {
    const id = 'm' + Date.now() + Math.floor(Math.random() * 1000)
    const messages = this.data.messages.concat([{ id, role, ...payload }])
    if (messages.length > HISTORY_MAX + 2) messages.splice(1, messages.length - HISTORY_MAX - 2)
    this.setData({ messages, scrollInto: id })
    return id
  },

  onInput(e) {
    this.setData({ question: e.detail.value })
  },

  // 抢跑：focus 早于键盘动画开始，立刻用上次记住的键盘高度让输入条先就位，
  // 键盘随后滑上来正好托住——观感同步（heightchange 回调本身晚于键盘动画，跟随必慢半拍）
  onKbShow() {
    if (this._lastKb) {
      this.setData({ kbH: Math.max(0, this._lastKb - (this._kbLift || 0) + (this._kbFix || 0)) })
    }
  },

  // 键盘高度跟随：adjust-position 已关，页面不动，输入条上浮正好贴住键盘顶部
  // （扣除输入条原位置下方的 aigc-tip + TabBar 空隙，避免键盘与输入条间露出一截空白）
  onKbHeight(e) {
    const kb = (e.detail && e.detail.height) || 0
    if (kb) this._lastKb = kb
    this.setData({ kbH: Math.max(0, kb - (this._kbLift || 0) + (this._kbFix || 0)) }, () => this._calibrate(kb))
  },

  // 实测校准：键盘动画结束后量输入条底边与键盘顶部的残差
  // （机型差异：iOS 键盘回调高度不含底部安全区、TabBar 异步挂载等都会造成固定推算不准）
  // 残差 >2px 就补进 _kbFix；同一键盘高度只校准一次，防止渐变回调叠加修正
  _calibrate(kb) {
    if (!kb || this._lastCal === kb) return
    this._lastCal = kb
    setTimeout(() => {
      wx.createSelectorQuery().select('.input-bar').boundingClientRect(rect => {
        if (!rect || !wx.getWindowInfo) return
        const win = wx.getWindowInfo()
        const gap = Math.round(rect.bottom - (win.windowHeight - kb))
        if (Math.abs(gap) > 2) {
          this._kbFix = (this._kbFix || 0) + gap
          this.setData({ kbH: Math.max(0, kb - (this._kbLift || 0) + this._kbFix) })
        }
      }).exec()
    }, 300)
  },

  onKbHide() {
    this._lastCal = 0
    this.setData({ kbH: 0 })
  },

  onHotTap(e) {
    const q = e.currentTarget.dataset.q
    this.setData({ question: q, inputFocus: true })
  },

  async onSend() {
    const q = this.data.question.trim()
    if (!q || this.data.asking) return
    if (countChars(q) > LIMITS.askMax) return toast(`最多问 ${LIMITS.askMax} 个字`)
    this.setData({ question: '', asking: true })
    this.pushMsg('user', { text: q })
    const aiId = this.pushMsg('ai', { text: '', loading: true })
    try {
      await guard()
      const res = await api.askQuery(q, this.history(), randId(24))
      // 无候选：引导发帖，不调模型
      if (!res || !res.answer) {
        this.replaceMsg(aiId, {
          text: '站内还没有能回答这个问题的分享，要不你来发一条？帮助下一位同学～',
          guidePost: true
        })
      } else {
        // 无引用不输出引用卡
        const cites = (res.citations || []).map(c => ({
          id: c.id,
          title: c.title,
          board: c.board,
          cover: c.cover || '',
          timeText: c.timeText || ''
        }))
        this.replaceMsg(aiId, { text: res.answer, cites })
      }
    } catch (e) {
      if (e && e.code === 40029) {
        this.replaceMsg(aiId, { text: '你问得有点频繁啦，休息一下再来吧～' })
      } else {
        this.replaceMsg(aiId, { text: '网络开小差了，请再问一次。', failed: true })
      }
    } finally {
      this.setData({ asking: false })
    }
  },

  /** 最近若干轮问答历史（环境契约支持 history 提升上下文连贯性） */
  history() {
    const pairs = []
    const msgs = this.data.messages
    let pendingQ = ''
    for (const m of msgs) {
      if (m.role === 'user') {
        pendingQ = m.text
      } else if (m.role === 'ai' && m.text && pendingQ) {
        pairs.push({ q: pendingQ, a: m.text })
        pendingQ = ''
      }
    }
    return pairs.slice(-HISTORY_MAX / 2)
  },

  replaceMsg(id, patch) {
    const idx = this.data.messages.findIndex(m => m.id === id)
    if (idx < 0) return
    this.setData({
      [`messages[${idx}]`]: { ...this.data.messages[idx], loading: false, ...patch },
      scrollInto: id
    })
  },

  onCiteTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/post/detail/detail?id=${id}` })
  },

  onGuidePost() {
    wx.navigateTo({ url: '/pages/post/create/create?board=life' })
  },

  onCopyChat() { /* 预留 */ },

  onShareAppMessage() {
    return { title: '来「好物分享」问学长学姐，站内好物一问便知', path: '/pages/index/index' }
  }
})
