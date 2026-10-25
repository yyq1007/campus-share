// patch-icons.js —— 向 gen-icons.js 注入 MVP 页面缺失的图标定义与输出条目
const fs = require('fs')
const p = __dirname + '/gen-icons.js'
let s = fs.readFileSync(p, 'utf8')

if (!s.includes("'arrow-left':")) {
  // 1) 注入 I 定义：插在 "const FILES = [" 之前
  const defs = `
  /* ---------- MVP 页面补充（别名 + 新图形） ---------- */
  'arrow-left': '<path d="M30 10 L18 24 L30 38"/>',
  'arrow-right': '<path d="M18 10 L30 24 L18 38"/>',
  'check': '<path d="M10 25 l9 9 L38 14"/>',
  'edit': '<path d="M30 8 l10 10 L20 38 H10 V28 Z"/><path d="M26 12 l10 10"/>',
  'note': '<rect x="9" y="8" width="30" height="32" rx="5"/><path d="M17 18 h14 M17 26 h14 M17 34 h8"/>',
  'info': '<circle cx="24" cy="24" r="16"/><path d="M24 22 v10"/>',
  'trash': '<path d="M12 14 h24"/><path d="M18 14 v-4 h12 v4"/><path d="M15 14 l2.5 26 h13 L33 14"/><path d="M21 21 v12 M27 21 v12"/>',
`
  s = s.replace('const FILES = [', defs + '\nconst FILES = [')

  // 2) FILES 追加输出条目：插在最后一个条目（empty-search 行）之后
  const entries = `
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
  ['heart-fill', I['heart'], 'fill', C.purple],
  ['star-fill', I['star'], 'fill', C.purple],
]
`
  // 把原数组收尾的 "]\n" 替换为追加条目 + "]"
  s = s.replace(/(  \['empty-search'[^\n]*\n)\]/, '$1' + entries.trimEnd().replace(/\]$/, '') )
  fs.writeFileSync(p, s)
  console.log('patched gen-icons.js')
} else {
  console.log('already patched')
}
