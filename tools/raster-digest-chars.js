/**
 * 周报按钮渐变字：SVG 源 → PNG（按 SVG 自带尺寸栅格化，保证高密度）
 * 与 tools/build-digest-chars.py 配套使用。
 */
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const DIR = path.join(__dirname, '..', 'miniprogram', 'assets', 'icons')

;(async () => {
  for (const name of ['digest-zhou', 'digest-bao']) {
    const src = path.join(DIR, name + '.svg')
    const svg = fs.readFileSync(src, 'utf8')
    const m = svg.match(/width="(\d+)" height="(\d+)"/)
    const [w, h] = [Number(m[1]), Number(m[2])]
    const buf = Buffer.from(svg)
    await sharp(buf, { density: 72 * 8 }).resize(w, h).png().toFile(path.join(DIR, name + '.png'))
    console.log(name, `${w}x${h}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
