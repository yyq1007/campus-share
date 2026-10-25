/**
 * 扫描小程序源码中出现的所有可见文案字符，用于字体子集化
 * 用法：node tools/collect-charset.js > tools/charset.txt
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', 'miniprogram')
const SKIP_DIRS = ['assets', 'node_modules']

// 需要保留的 ASCII 可见字符
const ASCII = (() => {
  let s = ''
  for (let i = 0x20; i <= 0x7e; i++) s += String.fromCharCode(i)
  return s
})()

const EXTRA = '　、。，！？；：“”‘’（）《》【】…—～·×÷°¥％℃±→←↑↓★☆●○◆◇■□▲△©®™'

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.includes(name)) continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      walk(p, out)
    } else if (/\.(wxml|js|json)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

const files = walk(ROOT, [])
const set = new Set(ASCII.split('').concat(EXTRA.split('')))
let total = 0

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  total += text.length
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    // CJK 统一表意 + 扩展 + 兼容 + 中文标点
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0xff00 && cp <= 0xffef)
    ) {
      set.add(ch)
    }
  }
}

const chars = Array.from(set).sort()
process.stdout.write(chars.join(''))
process.stderr.write(`[charset] files=${files.length} bytes=${total} uniqueChars=${chars.length}\n`)
