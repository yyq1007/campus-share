/**
 * 详情页 ↔ 列表页 点赞/收藏即时同步补丁
 * - writePatch：乐观更新瞬间就写入（不等服务端），列表页 onShow / 详情页 firstLoad 随时可读
 * - readFreshPatch：5s 窗口内视为「服务端可能还在途」，详情页渲染以补丁为准
 * - gcPatches：清理过期条目，防累积
 */
const FRESH_MS = 5000
const GC_MS = 60000

function writePatch(postId, patch) {
  if (!postId || !patch) return
  const app = getApp()
  const patches = app.globalData.interactionPatches || (app.globalData.interactionPatches = {})
  const cur = patches[postId] || {}
  patches[postId] = { ...cur, ...patch, ts: Date.now() }
}

function readFreshPatch(postId) {
  if (!postId) return null
  const patches = getApp().globalData.interactionPatches || {}
  const pt = patches[postId]
  return pt && Date.now() - (pt.ts || 0) < FRESH_MS ? pt : null
}

function gcPatches() {
  const app = getApp()
  const patches = app.globalData.interactionPatches
  if (!patches) return
  const now = Date.now()
  Object.keys(patches).forEach(k => {
    if (now - (patches[k].ts || 0) > GC_MS) delete patches[k]
  })
}

module.exports = { writePatch, readFreshPatch, gcPatches }
