/**
 * 扫描设计稿渲染图中某行/某列的颜色分布，用于定位元素边界
 * 用法: node tools/scan-design.js <page> <mode:row|col> <a> <b> [hex]
 *   mode=row a=y0 b=y1 → 逐列统计该行带内命中色的 x 区间
 *   mode=col a=x0 b=x1 → 逐行统计该列带内命中色的 y 区间
 */
const path = require('path')
const sharp = require('sharp')

const ROOT = 'E:\\workbuddy\\good finds WeChat\\design-v4'

;(async () => {
  const [page, mode, a, b, fill] = process.argv.slice(2)
  const src = path.join(ROOT, 'pages', `p${String(page).padStart(2, '0')}.png`)
  const img = sharp(src)
  const meta = await img.metadata()
  const s = meta.width / 375
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const target = (fill || '#6C5CE7').replace('#', '')
  const rgb = [
    parseInt(target.slice(0, 2), 16),
    parseInt(target.slice(2, 4), 16),
    parseInt(target.slice(4, 6), 16)
  ]
  const hit = (x, y) => {
    const i = (y * info.width + x) * ch
    return Math.abs(data[i] - rgb[0]) < 16 && Math.abs(data[i + 1] - rgb[1]) < 16 && Math.abs(data[i + 2] - rgb[2]) < 16
  }
  const runs = []
  if (mode === 'row') {
    const y0 = Math.round(Number(a) * s), y1 = Math.round(Number(b) * s)
    let start = -1
    for (let x = 0; x < info.width; x++) {
      let any = false
      for (let y = y0; y < y1; y++) if (hit(x, y)) { any = true; break }
      if (any && start < 0) start = x
      if (!any && start >= 0) { runs.push([+(start / s).toFixed(1), +(x / s).toFixed(1)]); start = -1 }
    }
    if (start >= 0) runs.push([+(start / s).toFixed(1), +(info.width / s).toFixed(1)])
  } else {
    const x0 = Math.round(Number(a) * s), x1 = Math.round(Number(b) * s)
    let start = -1
    for (let y = 0; y < info.height; y++) {
      let any = false
      for (let x = x0; x < x1; x++) if (hit(x, y)) { any = true; break }
      if (any && start < 0) start = y
      if (!any && start >= 0) { runs.push([+(start / s).toFixed(1), +(y / s).toFixed(1)]); start = -1 }
    }
    if (start >= 0) runs.push([+(start / s).toFixed(1), +(info.height / s).toFixed(1)])
  }
  console.log(JSON.stringify(runs))
})().catch(e => { console.error(e); process.exit(1) })
