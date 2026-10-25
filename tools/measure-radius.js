/**
 * 量取设计稿渲染图里某个纯色矩形的圆角半径（像素级）
 * 用法: node tools/measure-radius.js <page> <fillHex> [x0 y0 x1 y1]
 */
const path = require('path')
const sharp = require('sharp')

const ROOT = 'E:\\workbuddy\\good finds WeChat\\design-v4'

;(async () => {
  const [page, fill, xr, yr, wr, hr] = process.argv.slice(2)
  const src = path.join(ROOT, 'pages', `p${String(page).padStart(2, '0')}.png`)
  const img = sharp(src)
  const meta = await img.metadata()
  const s = meta.width / 375
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const target = fill.replace('#', '')
  const rgb = [
    parseInt(target.slice(0, 2), 16),
    parseInt(target.slice(2, 4), 16),
    parseInt(target.slice(4, 6), 16)
  ]
  const isTarget = (x, y) => {
    const i = (y * info.width + x) * ch
    return Math.abs(data[i] - rgb[0]) < 12 && Math.abs(data[i + 1] - rgb[1]) < 12 && Math.abs(data[i + 2] - rgb[2]) < 12
  }
  // 在指定区域内找到该颜色的包围盒
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  const region = (xr && wr)
    ? { x0: Math.round(xr * s), y0: Math.round(yr * s), x1: Math.round((+xr + +wr) * s), y1: Math.round((+yr + +hr) * s) }
    : { x0: 0, y0: 0, x1: info.width, y1: info.height }
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      if (isTarget(x, y)) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) { console.log('NOT FOUND', fill); return }
  // 找左边界上，y 从上到下第一个命中像素的 x → 圆角切点
  const leftX = x0
  let topY = null
  for (let y = y0; y <= y1; y++) {
    if (isTarget(leftX, y)) { topY = y; break }
  }
  // 半径 = 顶边左端的水平起点与边界线水平距离
  let topLeftX = null
  for (let x = leftX; x <= x1; x++) {
    if (isTarget(x, y0)) { topLeftX = x; break }
  }
  const r = (topLeftX === null) ? null : (topLeftX - leftX) / s
  console.log(JSON.stringify({
    page, fill,
    bbox_design: { x: +(x0 / s).toFixed(1), y: +(y0 / s).toFixed(1), w: +((x1 - x0) / s).toFixed(1), h: +((y1 - y0) / s).toFixed(1) },
    radius_design_px: r === null ? null : +r.toFixed(2)
  }))
})().catch(e => { console.error(e); process.exit(1) })
