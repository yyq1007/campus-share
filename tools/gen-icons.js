/**
 * gen-icons.js —— 生成 campus-share 小程序全套 SVG 线性图标
 * 设计规范：线性 1.5px 圆头（viewBox 48 → 24px 渲染时 stroke 3 ≈ 1.5px）
 * 颜色全部取自 docs/配色规范-v4.md（烘焙进 SVG，因 <image> 不支持外部染色）
 * 运行：node tools/gen-icons.js
 */
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'miniprogram', 'assets', 'icons')

const C = {
  gray: '#6B6780',   // text-2
  soft: '#716D82',   // text-3
  dark: '#2E2A3B',   // text-1
  purple: '#6C5CE7', // brand-700
  purple8: '#5A47C9',// brand-800
  white: '#FFFFFF',
  lavender: '#DCD3FB', // brand-200
  blush: '#FF9AA6'
}

// viewBox 48；stroke 线性图标模板
const line = (inner, stroke, sw = 3) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><g fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`

const fill = (inner, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><g fill="${color}">${inner}</g></svg>`

const I = {
  /* ---------- TabBar ---------- */
  'tab-home': '<path d="M8 22 L24 8 L40 22 V38 a2 2 0 0 1-2 2 H28 V29 H20 v11 H10 a2 2 0 0 1-2-2 Z"/>',
  'tab-ask': '<path d="M8 14 a4 4 0 0 1 4-4 h24 a4 4 0 0 1 4 4 v14 a4 4 0 0 1-4 4 H21 l-9 8 v-8 h-4 Z"/><path d="M17 19 h14" /><circle cx="24" cy="27" r="1.6" fill="currentColor"/>',
  'tab-me': '<circle cx="24" cy="16" r="7.5"/><path d="M9.5 40 c0-9.5 6.5-14 14.5-14 s14.5 4.5 14.5 14"/>',
  'send-plane': '<path d="M6 24 L42 8 L30 42 L24 28 Z"/>',
  'tab-publish': '<path d="M24 10 v28 M10 24 h28"/>',
  'publish-circle': '<circle cx="24" cy="24" r="14"/><path d="M24 17.5 v13 M17.5 24 h13"/>',

  /* ---------- 通用功能 ---------- */
  'search': '<circle cx="21" cy="21" r="11.5"/><path d="M29.5 29.5 L40 40"/>',
  'chevron-right': '<path d="M18 10 L30 24 L18 38"/>',
  'chevron-left': '<path d="M30 10 L18 24 L30 38"/>',
  'back-white': '<path d="M30 10 L18 24 L30 38"/>',
  'heart': '<path d="M24 40.5 C10.5 31.5 6.5 24 10.4 16.6 c2.9-5.6 11-5.9 13.6-.5 2.6-5.4 10.7-5.1 13.6.5 3.9 7.4-.1 14.9-13.6 23.9 Z"/>',
  'star': '<path d="M24 7 l5.7 11.6 12.8 1.8 -9.2 9 2.2 12.6 L24 36 l-11.5 6 2.2-12.6 -9.2-9 12.8-1.8 Z"/>',
  'comment': '<path d="M24 9 c-11.5 0-19 6-19 13.5 0 6.5 5.2 11.5 12.5 12.6 L17 41 l7.5-5.5 c10-1 18.5-6 18.5-13 C43 15 35.5 9 24 9 Z"/>',
  'share': '<path d="M8 26 v11 a3 3 0 0 0 3 3 h26 a3 3 0 0 0 3-3 V26"/><path d="M24 31 V8"/><path d="M14.5 17.5 L24 8 l9.5 9.5"/>',
  'flag': '<path d="M12 8 v32"/><path d="M12 10.5 h21 l-5.5 7 5.5 7 H12"/>',
  'camera': '<path d="M17 14 l3-5 h8 l3 5"/><rect x="7" y="14" width="34" height="26" rx="6"/><circle cx="24" cy="27" r="7"/>',
  'image': '<rect x="8" y="10" width="32" height="28" rx="5"/><circle cx="17" cy="19" r="3"/><path d="M10 34 l9-9 6 6 5-5 8 8"/>',
  'video': '<rect x="7" y="14" width="25" height="20" rx="5"/><path d="M32 22.5 L41 16 v16 L32 25.5"/>',
  'close': '<path d="M12 12 L36 36 M36 12 L12 36"/>',
  'plus': '<path d="M24 10 v28 M10 24 h28"/>',
  'link': '<path d="M21 27 a7.5 7.5 0 0 1 0-10.6 l4.2-4.2 a7.5 7.5 0 0 1 10.6 10.6 l-2.1 2.1"/><path d="M27 21 a7.5 7.5 0 0 1 0 10.6 l-4.2 4.2 A7.5 7.5 0 0 1 12.2 25.2 l2.1-2.1"/>',
  'clock': '<circle cx="24" cy="24" r="16"/><path d="M24 13.5 V24 l7 4.5"/>',
  'bell': '<path d="M24 8 a10 10 0 0 1 10 10 v7.5 l4 6.5 H10 l4-6.5 V18 a10 10 0 0 1 10-10 Z"/><path d="M20 37 a4 4 0 0 0 8 0"/>',
  'shield': '<path d="M24 6 L40 12 v12 c0 10-7.2 15.8-16 18 C15.2 39.8 8 34 8 24 V12 Z"/><path d="M16.5 24 l5.5 5.5 L32 18.5"/>',
  'refresh': '<path d="M40 24 a16 16 0 1 1-4.7-11.3"/><path d="M36.5 5.5 v8.5 H28"/>',
  'copy': '<rect x="17" y="17" width="23" height="23" rx="5"/><path d="M31 11 H13 a4 4 0 0 0-4 4 v18"/>',
  'send': '<path d="M42 7 L6 21.5 l13.5 5.5 L25 41 Z"/><path d="M42 7 L19.5 27"/>',
  'play': '<path d="M18 12.5 L38.5 24 L18 35.5 Z"/>',
  'ai-sparkle': '<path d="M24 5 c2.2 9.3 6.7 13.8 16 16 -9.3 2.2-13.8 6.7-16 16 -2.2-9.3-6.7-13.8-16-16 9.3-2.2 13.8-6.7 16-16 Z"/><path d="M38 32 c.9 3.7 2.6 5.4 6.3 6.3 -3.7.9-5.4 2.6-6.3 6.3 -.9-3.7-2.6-5.4-6.3-6.3 3.7-.9 5.4-2.6 6.3-6.3 Z"/>',

  /* ---------- 分类贴纸（白线，置于糖果色底） ---------- */
  'sticker-lamp': '<path d="M8 25 a16 13 0 0 1 32 0 Z"/><path d="M24 25 v14"/><path d="M15 40.5 h18"/>',
  'sticker-bowl': '<path d="M8 23 h32 c0 9-7.2 14.5-16 14.5 S8 32 8 23 Z"/><path d="M17.5 12.5 c0-3 3-3 3-6 M27.5 12.5 c0-3 3-3 3-6"/>',
  'sticker-book': '<path d="M24 12.5 c-4.2-3-10.2-4-16-3 v25.5 c5.8-1 11.8 0 16 3 4.2-3 10.2-4 16-3 V9.5 c-5.8-1-11.8 0-16 3 Z"/><path d="M24 12.5 v25.5"/>',
  'sticker-calendar': '<rect x="8" y="10" width="32" height="31" rx="5"/><path d="M8 19 h32 M16.5 6 v7 M31.5 6 v7"/><circle cx="17" cy="28" r="1.4" fill="#FFFFFF" stroke="none"/><circle cx="24" cy="28" r="1.4" fill="#FFFFFF" stroke="none"/><circle cx="31" cy="28" r="1.4" fill="#FFFFFF" stroke="none"/><circle cx="17" cy="34" r="1.4" fill="#FFFFFF" stroke="none"/><circle cx="24" cy="34" r="1.4" fill="#FFFFFF" stroke="none"/>',

  /* ---------- 消息类型贴纸（白线） ---------- */
  'comment-white': '<path d="M24 9 c-11.5 0-19 6-19 13.5 0 6.5 5.2 11.5 12.5 12.6 L17 41 l7.5-5.5 c10-1 18.5-6 18.5-13 C43 15 35.5 9 24 9 Z"/>',
  'heart-white': '<path d="M24 40.5 C10.5 31.5 6.5 24 10.4 16.6 c2.9-5.6 11-5.9 13.6-.5 2.6-5.4 10.7-5.1 13.6.5 3.9 7.4-.1 14.9-13.6 23.9 Z"/>',
  'star-white': '<path d="M24 7 l5.7 11.6 12.8 1.8 -9.2 9 2.2 12.6 L24 36 l-11.5 6 2.2-12.6 -9.2-9 12.8-1.8 Z"/>',
  'bell-white': '<path d="M24 8 a10 10 0 0 1 10 10 v7.5 l4 6.5 H10 l4-6.5 V18 a10 10 0 0 1 10-10 Z"/><path d="M20 37 a4 4 0 0 0 8 0"/>',
  'shield-white': '<path d="M24 6 L40 12 v12 c0 10-7.2 15.8-16 18 C15.2 39.8 8 34 8 24 V12 Z"/><path d="M16.5 24 l5.5 5.5 L32 18.5"/>',
  'reply-white': '<path d="M13 20 h16 a9 9 0 0 1 9 9 v8"/><path d="M21 12 L13 20 l8 8"/>',

  /* ---------- 空态插画（软灰，可爱手绘感） ---------- */
  'empty-cat': '<path d="M9 26.5 h30 l-4.5 15 h-21 Z"/><path d="M15 26.5 c-1-10 2.5-16 9-16 s10 6 9 16"/><path d="M15.5 13.5 L12.5 6.5 19.5 10 M32.5 13.5 l3-7 -7 3.5"/><circle cx="20" cy="19" r="1.3" fill="#6B6780" stroke="none"/><circle cx="28" cy="19" r="1.3" fill="#6B6780" stroke="none"/><path d="M22.5 23.5 c1 1 2 1 3 0"/>',
  'empty-bowl': '<path d="M8 25 h32 c0 9-7.2 14.5-16 14.5 S8 34 8 25 Z"/><path d="M17.5 14.5 c0-3 3-3 3-6 M27.5 14.5 c0-3 3-3 3-6"/><path d="M18 30 c1 1 2 1 3 0 M27 30 c1 1 2 1 3 0"/>',
  'empty-cloud': '<path d="M14.5 36 a8.5 8.5 0 0 1 .5-17 a11 11 0 0 1 20.8-3 a7.5 7.5 0 0 1 1.7 20 Z"/><path d="M19 26 c1.2 1.2 2.6 1.2 3.8 0 M26 26 c1.2 1.2 2.6 1.2 3.8 0"/>',
  'empty-search': '<circle cx="20" cy="20" r="11"/><path d="M28 28 L39 39"/><path d="M15 20 c1-2.5 3-4 5.5-4.5"/>',

  /* ---------- MVP 页面补充（新图形） ---------- */
  'arrow-left': '<path d="M30 10 L18 24 L30 38"/>',
  'arrow-right': '<path d="M18 10 L30 24 L18 38"/>',
  'check': '<path d="M10 25 l9 9 L38 14"/>',
  'edit': '<path d="M30 8 l10 10 L20 38 H10 V28 Z"/><path d="M26 12 l10 10"/>',
  'note': '<rect x="9" y="8" width="30" height="32" rx="5"/><path d="M17 18 h14 M17 26 h14 M17 34 h8"/>',
  'info': '<circle cx="24" cy="24" r="16"/><path d="M24 22 v10"/>',
  'trash': '<path d="M12 14 h24"/><path d="M18 14 v-4 h12 v4"/><path d="M15 14 l2.5 26 h13 L33 14"/><path d="M21 21 v12 M27 21 v12"/>',

  /* ---------- v4 S6 我的页：紫色线性描边菜单图标 ---------- */
  // 我的分享：带折角文档（设计稿 S6 菜单行 1）
  'doc-fold': '<path d="M13 7 h15 l8 8 v25 a2 2 0 0 1 -2 2 H13 a2 2 0 0 1 -2 -2 V9 a2 2 0 0 1 2 -2 Z"/><path d="M28 7 v8 h8"/>',
  // 关于：圆圈 i（设计稿 S6 菜单行 4）
  'info-circle': '<circle cx="24" cy="24" r="16.5"/><path d="M24 21.5 v11"/><circle cx="24" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>',
  // 站内消息：铃铛（描边，带铃舌弧）
  'bell-line': '<path d="M24 8 a10 10 0 0 1 10 10 v7.5 l4 6.5 H10 l4-6.5 V18 a10 10 0 0 1 10-10 Z"/><path d="M20 37 a4 4 0 0 0 8 0"/>',
  // 收藏：五角星（描边）
  'star-line': '<path d="M24 7 l5.7 11.6 12.8 1.8 -9.2 9 2.2 12.6 L24 36 l-11.5 6 2.2-12.6 -9.2-9 12.8-1.8 Z"/>',

  /* ---------- v4 S7 审核台：实心彩色板块贴纸 ---------- */
  'sticker-bowl-solid': '<path d="M8 23 h32 c0 9-7.2 14.5-16 14.5 S8 32 8 23 Z"/><path d="M17.5 12.5 c0-3 3-3 3-6 M27.5 12.5 c0-3 3-3 3-6"/>',
  'sticker-book-solid': '<path d="M22.2 12.6 c-3.8-2.5-9-3.4-14.2-2.6 v25.4 c5.2-.8 10.4 .1 14.2 2.6 Z"/><path d="M25.8 12.6 c3.8-2.5 9-3.4 14.2-2.6 v25.4 c-5.2-.8-10.4 .1-14.2 2.6 Z"/>',
  'sticker-lamp-solid': '<path d="M8 25 a16 13 0 0 1 32 0 Z"/><path d="M24 25 v14"/><path d="M15 40.5 h18"/>'
}

const FILES = [
  // [文件名, 内容, 渲染方式]
  ['tab-home', I['tab-home'], 'line', C.gray],
  ['tab-home-on', I['tab-home'], 'line', C.purple8],
  ['tab-ask', I['tab-ask'], 'line', C.gray],
  ['tab-ask-on', I['tab-ask'], 'line', C.purple8],
  ['tab-me', I['tab-me'], 'line', C.gray],
  ['tab-me-on', I['tab-me'], 'line', C.purple8],
  ['tab-publish', I['tab-publish'], 'line', C.white],

  ['search', I['search'], 'line', C.soft],
  ['chevron-right', I['chevron-right'], 'line', C.soft],
  ['chevron-left', I['chevron-left'], 'line', C.dark],
  ['back-white', I['back-white'], 'line', C.white],

  ['heart', I['heart'], 'line', C.gray],
  ['star', I['star'], 'line', C.gray],
  ['comment', I['comment'], 'line', C.gray],
  ['share', I['share'], 'line', C.gray],
  ['flag', I['flag'], 'line', C.gray],
  ['camera', I['camera'], 'line', C.gray],
  ['camera-white', I['camera'], 'line', C.white],
  ['image', I['image'], 'line', C.gray],
  ['video', I['video'], 'line', C.gray],
  ['close-white', I['close'], 'line', C.white],
  ['close-gray', I['close'], 'line', C.soft],
  ['plus-soft', I['plus'], 'line', C.soft],
  ['plus-white', I['plus'], 'line', C.white],
  ['link', I['link'], 'line', C.purple8],
  ['clock', I['clock'], 'line', C.soft],
  ['bell', I['bell'], 'line', C.gray],
  ['shield', I['shield'], 'line', C.purple8],
  ['refresh', I['refresh'], 'line', C.soft],
  ['copy', I['copy'], 'line', C.purple8],
  ['ai-sparkle', I['ai-sparkle'], 'line', C.purple],
  ['play-white', I['play'], 'fill', C.white],

  ['heart-on', I['heart'], 'fill', C.purple],
  ['star-on', I['star'], 'fill', C.purple],
  ['send-white', I['send'], 'fill', C.white],

  ['sticker-lamp', I['sticker-lamp'], 'line', C.white],
  ['sticker-bowl', I['sticker-bowl'], 'line', C.white],
  ['sticker-book', I['sticker-book'], 'line', C.white],
  ['sticker-calendar', I['sticker-calendar'], 'line', C.white],

  ['comment-white', I['comment-white'], 'line', C.white],
  ['heart-white', I['heart-white'], 'line', C.white],
  ['star-white', I['star-white'], 'line', C.white],
  ['bell-white', I['bell-white'], 'line', C.white],
  ['shield-white', I['shield-white'], 'line', C.white],
  ['reply-white', I['reply-white'], 'line', C.white],

  ['empty-cat', I['empty-cat'], 'line', C.gray],
  ['empty-bowl', I['empty-bowl'], 'line', C.gray],
  ['empty-cloud', I['empty-cloud'], 'line', C.gray],
  ['empty-search', I['empty-search'], 'line', C.gray],

  ['arrow-left', I['arrow-left'], 'line', C.dark],
  ['arrow-right', I['arrow-right'], 'line', C.soft],
  ['send', I['send'], 'line', C.white],
  ['plus', I['plus'], 'line', C.white],
  ['close', I['close'], 'line', C.white],
  ['check', I['check'], 'line', C.white],
  ['edit', I['edit'], 'line', C.gray],
  ['note', I['note'], 'line', C.purple8],
  ['info', I['info'], 'line', C.gray],
  ['trash', I['trash'], 'line', C.gray],
  ['send-plane', I['send-plane'], 'fill', C.white],
  ['heart-fill', I['heart'], 'fill', C.purple],
  ['star-fill', I['star'], 'fill', C.purple],

  /* ---------- v4 设计稿对齐：主色/灰色变体 ---------- */
  ['search-primary', I['search'], 'line', C.purple],
  ['chevron-right-primary', I['chevron-right'], 'line', C.purple],
  ['tab-publish-line', I['publish-circle'], 'line', C.gray],

  /* ---------- v4 S6 我的页：紫色线性描边菜单图标 ---------- */
  ['doc-fold', I['doc-fold'], 'line', C.purple8],
  ['camera-primary', I['camera'], 'line', C.purple8],
  ['star-line', I['star-line'], 'line', C.purple8],
  ['bell-line', I['bell-line'], 'line', C.purple8],
  ['info-circle', I['info-circle'], 'line', C.purple8],
  ['shield-line', I['shield'], 'line', C.purple8],
  ['chevron-right-soft', I['chevron-right'], 'line', C.soft],

  /* ---------- v4 S7 审核台：实心彩色板块贴纸 ---------- */
  ['sticker-bowl-solid', I['sticker-bowl-solid'], 'fill', '#B5445C'],
  ['sticker-book-solid', I['sticker-book-solid'], 'fill', '#1B5FBF'],
  ['sticker-lamp-solid', I['sticker-lamp-solid'], 'fill', '#0E6E63']
]

fs.mkdirSync(OUT, { recursive: true })
const manifest = []
for (const [name, inner, mode, color] of FILES) {
  const svg = mode === 'fill' ? fill(inner, color) : line(inner, color)
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg)
  manifest.push(name)
}
fs.writeFileSync(path.join(__dirname, 'icons-manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`OK: ${manifest.length} icons -> ${OUT}`)
