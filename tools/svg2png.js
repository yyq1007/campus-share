/**
 * SVG → PNG 栅格化：小程序 <image> 对本地 SVG 兼容差（真机基本不支持），
 * 构建时统一转 PNG（2x 密度），SVG 仅作源文件保留。
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', 'miniprogram', 'assets')

async function convertDir(dir, width) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.svg'))
  for (const f of files) {
    const src = path.join(dir, f)
    const out = path.join(dir, f.replace(/\.svg$/, '.png'))
    await sharp(src, { density: 300 }).resize({ width }).png().toFile(out)
  }
  return files.length
}

;(async () => {
  const n1 = await convertDir(path.join(ROOT, 'icons'), 144) // 48 viewBox × 3x
  const n2 = await convertDir(path.join(ROOT, 'deco'), 480)  // 贴纸插画
  console.log(`OK icons:${n1} deco:${n2}`)
})().catch(e => { console.error(e); process.exit(1) })
