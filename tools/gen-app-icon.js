/**
 * gen-app-icon.js —— 生成小程序图标候选（主紫 #6C5CE7，v6 粘土风）
 * 用法：node tools/gen-app-icon.js
 * 输出：design/app-icon/*.png（512 主图 + 144 预览 + 对比图）
 * 微信上传图标自动裁圆角，做成全出血方形即可
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const OUT = path.join(__dirname, '..', 'design', 'app-icon')
fs.mkdirSync(OUT, { recursive: true })

// v6 主色口径（队友定）：紫罗兰
const P700 = '#6C5CE7'
const P800 = '#5A47C9'
const P200 = '#DCD3FB'
const MINT = '#4ECDC4'
const SKY = '#5AA9FF'
const CORAL = '#FF7A8A'

/** A：紫渐变底 + 白气泡 + 爱心 + 星星 */
const svgA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${P700}"/><stop offset="1" stop-color="${P800}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <path d="M136 118 h240 a44 44 0 0 1 44 44 v148 a44 44 0 0 1 -44 44 h-150 l-62 56 v-56 h-28 a44 44 0 0 1 -44 -44 v-148 a44 44 0 0 1 44 -44 z" fill="#FFFFFF"/>
  <path d="M256 300 c-40 -30 -66 -52 -66 -82 a34 34 0 0 1 62 -18 l4 6 4 -6 a34 34 0 0 1 62 18 c0 30 -26 52 -66 82 z" fill="${CORAL}"/>
  <path d="M120 132 l7 18 18 7 -18 7 -7 18 -7 -18 -18 -7 18 -7 z" fill="#FFE28A"/>
  <path d="M396 128 l5 14 14 5 -14 5 -5 14 -5 -14 -14 -5 14 -5 z" fill="${P200}"/>
  <circle cx="404" cy="330" r="10" fill="${MINT}" opacity="0.9"/>
</svg>`

/** B：紫渐变底 + 纸飞机 + 三色速度线 */
const svgB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${P700}"/><stop offset="1" stop-color="${P800}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g fill="#FFFFFF">
    <path d="M112 268 L396 140 c14 -6 26 8 20 21 l-96 212 c-6 13 -25 12 -29 -2 l-26 -84 z"/>
    <path d="M265 287 l-24 78 46 -44 z" fill="${P200}"/>
  </g>
  <g stroke-linecap="round" fill="none" stroke-width="16">
    <path d="M96 356 h72" stroke="${MINT}"/>
    <path d="M128 400 h88" stroke="${SKY}"/>
    <path d="M96 444 h56" stroke="${CORAL}"/>
  </g>
  <circle cx="392" cy="112" r="12" fill="#FFE28A"/>
</svg>`

/** C：浅渐变底 + 紫气泡 + 三板块色圆点（贴设计稿） */
const svgC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F5F1FF"/><stop offset="1" stop-color="#EAF4FF"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <path d="M136 132 h240 a52 52 0 0 1 52 52 v128 a52 52 0 0 1 -52 52 h-140 l-66 60 v-60 h-34 a52 52 0 0 1 -52 -52 v-128 a52 52 0 0 1 52 -52 z" fill="${P700}"/>
  <circle cx="192" cy="248" r="26" fill="#FFFFFF"/>
  <circle cx="256" cy="248" r="26" fill="#FFFFFF"/>
  <circle cx="320" cy="248" r="26" fill="#FFFFFF"/>
  <circle cx="192" cy="248" r="12" fill="${MINT}"/>
  <circle cx="256" cy="248" r="12" fill="${SKY}"/>
  <circle cx="320" cy="248" r="12" fill="${CORAL}"/>
  <path d="M108 96 l8 22 22 8 -22 8 -8 22 -8 -22 -22 -8 22 -8 z" fill="#FFE28A"/>
  <path d="M404 108 l6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6 z" fill="${P700}"/>
</svg>`

/** E：v6 粘土风——立体气泡 + 粘土爱心 + 柔和投影 */
const svgE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bgE" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8265F0"/><stop offset="1" stop-color="#5A3FD0"/>
    </linearGradient>
    <linearGradient id="bubE" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EFE9FF"/>
    </linearGradient>
    <linearGradient id="heartE" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FF9DAE"/><stop offset="1" stop-color="#F25A76"/>
    </linearGradient>
    <radialGradient id="glowE" cx="0.3" cy="0.25" r="0.9">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.14"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="dropE" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#2A1670" flood-opacity="0.38"/>
    </filter>
    <filter id="inE" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#D9486A" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#bgE)"/>
  <rect width="512" height="512" fill="url(#glowE)"/>
  <g filter="url(#dropE)">
    <path d="M140 112 h232 a52 52 0 0 1 52 52 v140 a52 52 0 0 1 -52 52 h-146 l-64 58 v-58 h-22 a52 52 0 0 1 -52 -52 v-140 a52 52 0 0 1 52 -52 z" fill="url(#bubE)"/>
    <path d="M148 122 h216 a44 44 0 0 1 44 44 v6 a44 44 0 0 0 -44 -38 h-216 a44 44 0 0 0 -44 38 v-6 a44 44 0 0 1 44 -44 z" fill="#FFFFFF" opacity="0.85"/>
  </g>
  <g filter="url(#inE)">
    <path d="M256 296 c-44 -32 -72 -56 -72 -88 a37 37 0 0 1 68 -19 l4 7 4 -7 a37 37 0 0 1 68 19 c0 32 -28 56 -72 88 z" fill="url(#heartE)"/>
    <ellipse cx="212" cy="196" rx="16" ry="10" fill="#FFD3DC" opacity="0.9" transform="rotate(-24 212 196)"/>
  </g>
  <path d="M104 400 l8 22 22 8 -22 8 -8 22 -8 -22 -22 -8 22 -8 z" fill="#FFE28A" opacity="0.95"/>
  <path d="M412 108 l6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6 z" fill="#DCD3FB"/>
  <circle cx="416" cy="376" r="11" fill="#4ECDC4" opacity="0.95"/>
</svg>`

/** F：v6 粘土风——立体气泡 + 三板块色粘土圆点 */
const svgF = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bgF" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8265F0"/><stop offset="1" stop-color="#5A3FD0"/>
    </linearGradient>
    <linearGradient id="bubF" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EFE9FF"/>
    </linearGradient>
    <radialGradient id="glowF" cx="0.3" cy="0.25" r="0.9">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.14"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="dropF" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#2A1670" flood-opacity="0.38"/>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#bgF)"/>
  <rect width="512" height="512" fill="url(#glowF)"/>
  <g filter="url(#dropF)">
    <path d="M140 112 h232 a52 52 0 0 1 52 52 v140 a52 52 0 0 1 -52 52 h-146 l-64 58 v-58 h-22 a52 52 0 0 1 -52 -52 v-140 a52 52 0 0 1 52 -52 z" fill="url(#bubF)"/>
    <path d="M148 122 h216 a44 44 0 0 1 44 44 v6 a44 44 0 0 0 -44 -38 h-216 a44 44 0 0 0 -44 38 v-6 a44 44 0 0 1 44 -44 z" fill="#FFFFFF" opacity="0.85"/>
  </g>
  <circle cx="188" cy="242" r="30" fill="#4ECDC4"/>
  <circle cx="188" cy="236" r="26" fill="#67DCD4" opacity="0.9"/>
  <circle cx="256" cy="242" r="30" fill="#5AA9FF"/>
  <circle cx="256" cy="236" r="26" fill="#7BBBFF" opacity="0.9"/>
  <circle cx="324" cy="242" r="30" fill="#FF7A8A"/>
  <circle cx="324" cy="236" r="26" fill="#FF97A3" opacity="0.9"/>
  <path d="M104 400 l8 22 22 8 -22 8 -8 22 -8 -22 -22 -8 22 -8 z" fill="#FFE28A" opacity="0.95"/>
  <circle cx="416" cy="376" r="11" fill="#FFB56A" opacity="0.95"/>
</svg>`

async function render(name, svg) {
  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(OUT, `${name}-512.png`))
  await sharp(Buffer.from(svg)).resize(144, 144).png().toFile(path.join(OUT, `${name}-144.png`))
  console.log('OK', name)
}

;(async () => {
  // 注：cat-icon-all.png 实为 v6「全部」板块卡（带文字），不适合做 app 图标，方案 D 已废弃
  await render('A-bubble-heart', svgA)
  await render('B-plane', svgB)
  await render('C-handbook-dots', svgC)
  await render('E-clay-heart', svgE)
  await render('F-clay-dots', svgF)

  const five = ['A-bubble-heart', 'B-plane', 'C-handbook-dots', 'E-clay-heart', 'F-clay-dots']
  const imgs = five.map(n => path.join(OUT, `${n}-512.png`))
  await sharp({ create: { width: 512 * 3 + 80, height: 512 * 2 + 60, channels: 4, background: '#FFFFFF' } })
    .composite(imgs.map((f, i) => ({ input: f, left: 20 + (i % 3) * (512 + 20), top: 20 + Math.floor(i / 3) * (512 + 20) })))
    .png().toFile(path.join(OUT, 'compare.png'))

  const clay = ['E-clay-heart', 'F-clay-dots'].map(n => path.join(OUT, `${n}-512.png`))
  await sharp({ create: { width: 512 * 2 + 60, height: 512 + 40, channels: 4, background: '#FFFFFF' } })
    .composite(clay.map((f, i) => ({ input: f, left: 20 + i * (512 + 20), top: 20 })))
    .png().toFile(path.join(OUT, 'compare-clay.png'))
  console.log('ALL DONE ->', OUT)
})().catch(e => { console.error(e); process.exit(1) })
