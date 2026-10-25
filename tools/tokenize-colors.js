/**
 * V-01 收敛：把页面层 WXSS 中的硬编码色值替换为 theme.wxss 语义令牌
 * 用法：node tools/tokenize-colors.js
 *
 * 规则：
 *   color: #FFFFFF        → color: var(--text-on-brand)   （按钮/图标上的白字）
 *   background: #FFFFFF   → background: var(--bg-elevated) （卡片/面板底）
 *   渐变中的 #FFFFFF       → var(--bg-elevated)
 *   #FFE7EC（珊瑚底）      → var(--coral-bg)
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', 'miniprogram')

const RULES = [
  // 白字（在 color 声明后）
  { re: /(\bcolor:\s*)#FFFFFF\b/g, to: '$1var(--text-on-brand)' },
  // 白底（background 声明后）
  { re: /(\bbackground:\s*)#FFFFFF\b/g, to: '$1var(--bg-elevated)' },
  // 渐变/其他位置剩余的白
  { re: /#FFFFFF\b/g, to: 'var(--bg-elevated)' },
  // 珊瑚粉底
  { re: /(\bbackground:\s*)#FFE7EC\b/g, to: '$1var(--coral-bg)' },
  { re: /#FFE7EC\b/g, to: 'var(--coral-bg)' },
  // 淡紫底
  { re: /(\bbackground:\s*)#EDE9FE\b/g, to: '$1var(--primary-tint)' }
]

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'assets' || name === 'node_modules') continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.wxss')) out.push(p)
  }
  return out
}

let changed = 0
for (const f of walk(ROOT, [])) {
  if (f.endsWith('theme.wxss')) continue
  const before = fs.readFileSync(f, 'utf8')
  let after = before
  for (const r of RULES) after = after.replace(r.re, r.to)
  if (after !== before) {
    fs.writeFileSync(f, after, 'utf8')
    const n = (before.match(/#FFFFFF|#FFE7EC|#EDE9FE/g) || []).length
    console.log(`[tokenize] ${path.relative(ROOT, f)}  替换 ${n} 处`)
    changed += n
  }
}
console.log(`\n共替换 ${changed} 处硬编码色值`)
