/**
 * 采样设计稿渲染图中某点的颜色
 * 用法: node tools/sample-color.js <page> <x> <y> [x2 y2 ...]
 */
const path = require('path')
const sharp = require('sharp')

const ROOT = 'E:\\workbuddy\\good finds WeChat\\design-v4'

;(async () => {
  const [page, ...pts] = process.argv.slice(2)
  const src = path.join(ROOT, 'pages', `p${String(page).padStart(2, '0')}.png`)
  const img = sharp(src)
  const meta = await img.metadata()
  const s = meta.width / 375
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const out = []
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = Math.round(Number(pts[i]) * s)
    const y = Math.round(Number(pts[i + 1]) * s)
    const idx = (y * info.width + x) * ch
    const hex = '#' + [data[idx], data[idx + 1], data[idx + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
    out.push({ x: pts[i], y: pts[i + 1], hex })
  }
  console.log(JSON.stringify(out))
})().catch(e => { console.error(e); process.exit(1) })
