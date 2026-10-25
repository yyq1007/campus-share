/**
 * 裁剪 + 放大设计稿渲染图的局部区域，用于逐屏视觉核对细节
 * 用法: node tools/crop-design.js <page 1-9> <x> <y> <w> <h> <scale> [outName]
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = 'E:\\workbuddy\\good finds WeChat\\design-v4'
const OUT = path.join(ROOT, 'crops')

;(async () => {
  const [page, x, y, w, h, scale, name] = process.argv.slice(2)
  const src = path.join(ROOT, 'pages', `p${String(page).padStart(2, '0')}.png`)
  const meta = await sharp(src).metadata()
  const scaleBack = meta.width / 375
  const left = Math.round(Number(x) * scaleBack)
  const top = Math.round(Number(y) * scaleBack)
  const width = Math.round(Number(w) * scaleBack)
  const height = Math.round(Number(h) * scaleBack)
  fs.mkdirSync(OUT, { recursive: true })
  const out = path.join(OUT, `${name || `p${page}-${x}-${y}`}.png`)
  await sharp(src)
    .extract({ left, top, width, height })
    .resize({ width: Math.round(width * (Number(scale) || 2)) })
    .png()
    .toFile(out)
  console.log('OK', out, `${width}x${height} -> scale ${scale}`)
})().catch(e => { console.error(e); process.exit(1) })
