/**
 * 云函数调用统一封装：拆包、超时、错误规范化
 * 所有页面禁止直接 wx.cloud.callFunction，统一走 callFn
 */
const TIMEOUT = 10000

function callFn(name, data = {}, { loading = false, timeout = TIMEOUT } = {}) {
  if (loading) wx.showLoading({ title: '加载中', mask: true })
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        if (loading) wx.hideLoading()
        reject({ code: -1, msg: '请求超时，请稍后再试' })
      }
    }, timeout)

    wx.cloud.callFunction({
      name,
      data
    }).then(res => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (loading) wx.hideLoading()
      const r = res.result || {}
      if (r.code === 0) {
        // 保留 r.data 之外的字段（如 40010 的 ranges 会随 data 返回）
        resolve(r.data !== undefined ? r.data : r)
      } else {
        reject({ code: r.code, msg: r.msg || '服务开小差了', data: r.data })
      }
    }).catch(err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (loading) wx.hideLoading()
      console.error('[callFn]', name, err)
      reject({ code: -1, msg: '网络不稳定，请重试', raw: err })
    })
  })
}

function toast(msg, icon = 'none') {
  wx.showToast({ title: msg, icon, duration: 1500 })
}

module.exports = { callFn, toast }
