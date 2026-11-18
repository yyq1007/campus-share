/**
 * gen-app-icon.js —— 生成小程序图标（主紫 #6C5CE7）
 * 用法：node tools/gen-app-icon.js
 * 输出：design/app-icon/*.png（512 主图 + 144 预览）
 * 注意：微信上传图标时会自动裁圆角，所以做成全出血方形，不自带圆角
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const OUT = path.join(__dirname, '..', 'design', 'app-icon')
fs.mkdirSync(OUT, { recursive: true })

// 图标专用紫色（用户反馈 #6C5CE7 偏蓝 → 色相从 247° 调到 270° 纯紫区）
const P700 = '#9B5CF0'   // 主紫（图标用，色相 271°）
const P800 = '#7C3ED6'   // 深紫（渐变深端）
const P200 = '#E6D4FF'   // 淡紫高光
const MINT = '#4ECDC4'   // 板块·生活
const SKY  = '#5AA9FF'   // 板块·学习
const CORAL = '#FF7A8A'  // 板块·美食

/** 方案一：紫渐变底 + 白色对话气泡 + 爱心 + 星星（经典分享感） */
const svgA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${P700}"/>
      <stop offset="1" stop-color="${P800}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- 对话气泡（圆角矩形 + 小尾巴） -->
  <path d="M136 118 h240 a44 44 0 0 1 44 44 v148 a44 44 0 0 1 -44 44 h-150 l-62 56 v-56 h-28 a44 44 0 0 1 -44 -44 v-148 a44 44 0 0 1 44 -44 z" fill="#FFFFFF"/>
  <!-- 爱心 -->
  <path d="M256 300 c-40 -30 -66 -52 -66 -82 a34 34 0 0 1 62 -18 l4 6 4 -6 a34 34 0 0 1 62 18 c0 30 -26 52 -66 82 z" fill="${CORAL}"/>
  <!-- 星星点缀 -->
  <path d="M120 132 l7 18 18 7 -18 7 -7 18 -7 -18 -18 -7 18 -7 z" fill="#FFE28A"/>
  <path d="M396 128 l5 14 14 5 -14 5 -5 14 -5 -14 -14 -5 14 -5 z" fill="${P200}"/>
  <circle cx="404" cy="330" r="10" fill="${MINT}" opacity="0.9"/>
</svg>`

/** 方案二：紫底白纸飞机（「发出一条分享」的动势） */
const svgB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${P700}"/>
      <stop offset="1" stop-color="${P800}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- 纸飞机 -->
  <g fill="#FFFFFF">
    <path d="M112 268 L396 140 c14 -6 26 8 20 21 l-96 212 c-6 13 -25 12 -29 -2 l-26 -84 z"/>
    <path d="M265 287 l-24 78 46 -44 z" fill="${P200}"/>
  </g>
  <!-- 速度线（三色板块色，呼应板块体系） -->
  <g stroke-linecap="round" fill="none" stroke-width="16">
    <path d="M96 356 h72" stroke="${MINT}"/>
    <path d="M128 400 h88" stroke="${SKY}"/>
    <path d="M96 444 h56" stroke="${CORAL}"/>
  </g>
  <circle cx="392" cy="112" r="12" fill="#FFE28A"/>
</svg>`

/** 方案三：浅紫渐变底 + 紫色描边气泡 + 三板块色圆点（手账感，最贴设计稿） */
const svgC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F5F1FF"/>
      <stop offset="1" stop-color="#EAF4FF"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- 对话气泡：主紫实底 -->
  <path d="M136 132 h240 a52 52 0 0 1 52 52 v128 a52 52 0 0 1 -52 52 h-140 l-66 60 v-60 h-34 a52 52 0 0 1 -52 -52 v-128 a52 52 0 0 1 52 -52 z" fill="${P700}"/>
  <!-- 内部：三个板块色圆点（生活/学习/美食） -->
  <circle cx="192" cy="248" r="26" fill="#FFFFFF"/>
  <circle cx="256" cy="248" r="26" fill="#FFFFFF"/>
  <circle cx="320" cy="248" r="26" fill="#FFFFFF"/>
  <circle cx="192" cy="248" r="12" fill="${MINT}"/>
  <circle cx="256" cy="248" r="12" fill="${SKY}"/>
  <circle cx="320" cy="248" r="12" fill="${CORAL}"/>
  <!-- 手账贴纸感星星 -->
  <path d="M108 96 l8 22 22 8 -22 8 -8 22 -8 -22 -22 -8 22 -8 z" fill="#FFE28A"/>
  <path d="M404 108 l6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6 z" fill="${P700}"/>

</svg>`

async function render(name, svg) {
  const master = path.join(OUT, `${name}-512.png`)
  const small = path.join(OUT, `${name}-144.png`)
  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(master)
  await sharp(Buffer.from(svg)).resize(144, 144).png().toFile(small)
  console.log('OK', name)
}

;(async () => {
  await render('A-bubble-heart', svgA)
  await render('B-plane', svgB)
  await render('C-handbook-dots', svgC)
  // 拼一张对比图（三选一方便看）
  const imgs = ['A-bubble-heart', 'B-plane', 'C-handbook-dots'].map(n => path.join(OUT, `${n}-512.png`))
  await sharp({ create: { width: 512 * 3 + 80, height: 512 + 40, channels: 4, background: '#FFFFFF' } })
    .composite(imgs.map((f, i) => ({ input: f, left: 20 + i * (512 + 20), top: 20 })))
    .png().toFile(path.join(OUT, 'compare.png'))
  console.log('ALL DONE ->', OUT)
})().catch(e => { console.error(e); process.exit(1) })
