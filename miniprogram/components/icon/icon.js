// 图标统一渲染：包内路径直出
// 历史教训：cloud:// fileID 不能直接用作 <image src>（必须经 getTempFileURL 转 https 临时链接），
// 直塞会导致每个图标先失败一次（开发者工具代理 500 / 真机渲染错误）再走 onError 兜底。
// 75 个图标 PNG 已全量打包（合计 <100KB），包内路径零网络、零 CORS、首屏立即可见。
const { localIcon } = require('../../utils/icons')

Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: Number, value: 48 } // rpx
  },
  data: {
    src: '',
    failed: false
  },
  observers: {
    name(n) {
      if (!n) return
      this.setData({ src: localIcon(n), failed: false })
    }
  }
})
