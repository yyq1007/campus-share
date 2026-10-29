/**
 * 精确复现首页 toggleInteraction 的行为，看两个症状能否复现。
 *
 * 症状1：首页点赞后数字 +1（本地乐观更新生效）
 * 症状2：点进详情页数字没变（云端没更新）
 * 症状3：刷新首页数字回到原值
 *
 * 关键怀疑点：
 *   a) api.interactionToggle 失败但被 catch 吞掉？—— 不，失败会回滚并 toast
 *   b) interactionToggle 用的 targetId 是 post.id，但云端 interId 用的是 targetId
 *   c) 首页调用的 api.interactionToggle 签名不对
 */
const { patchPost, collectPatches } = require('../miniprogram/utils/post-sync')

console.log('=== 1. api.interactionToggle 的签名 ===')
const apiSrc = require('fs').readFileSync('./miniprogram/utils/api.js', 'utf-8')
const m = apiSrc.match(/function interactionToggle[\s\S]{0,300}/)
console.log(m ? m[0] : 'not found')

console.log()
console.log('=== 2. 首页调用的形式 ===')
const idxSrc = require('fs').readFileSync('./miniprogram/pages/index/index.js', 'utf-8')
const m2 = idxSrc.match(/await api\.interactionToggle[^)]*\)/)
console.log('  ', m2 ? m2[0] : 'not found')

console.log()
console.log('=== 3. 详情页调用的形式（对照）===')
const detSrc = require('fs').readFileSync('./miniprogram/pages/post/detail/detail.js', 'utf-8')
const m3 = detSrc.match(/await api\.interactionToggle[^)]*\)/)
console.log('  ', m3 ? m3[0] : 'not found')

console.log()
console.log('=== 4. 首页 toggleInteraction 有没有调 patchPost ===')
const tg = idxSrc.match(/async toggleInteraction[\s\S]{0,1200}/)
if (tg) {
  const body = tg[0]
  console.log('  含 patchPost :', body.includes('patchPost'))
  console.log('  含 applyPostPatches :', body.includes('applyPostPatches'))
} else {
  console.log('  not found')
}
console.log('  整文件是否 import patchPost:', idxSrc.includes('patchPost'))

console.log()
console.log('=== 5. 首页 import 了什么 ===')
idxSrc.split('\n').filter(l => l.includes('require(')).forEach(l => console.log('  ', l.trim()))

console.log()
console.log('=== 6. 详情页 import 了什么 ===')
detSrc.split('\n').filter(l => l.includes('require(')).forEach(l => console.log('  ', l.trim()))
