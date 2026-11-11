/**
 * 把 Alkatra 数字子集（woff2）同步进 app.js 的 NUMBER_FONT_DATA_URL。
 *
 * 背景：wx.loadFontFace 的 source 只支持 https 或 Data URL，包内路径不被支持；
 *      字体只有 11 个字形（0-9 与句点）1.7KB，内联进 app.js 比新建 js 模块更稳
 *      （历史问题：新增 utils/*.js 偶尔不被编译器注册，报 module is not defined）。
 *
 * 源文件：miniprogram/assets/alkatra-digits.woff2
 *   由 @fontsource/alkatra 5.3.0 的 alkatra-latin-400-normal.woff2 子集化而来，命令：
 *   python -m fontTools.subset alkatra-400.ttf \
 *     --unicodes=U+0030-0039,U+002E --layout-features='' --no-hinting \
 *     --desubroutinize --flavor=woff2 --output-file=alkatra-digits.woff2
 *
 * 用法：node tools/build-alkatra-data.js
 */
const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', 'miniprogram', 'assets', 'alkatra-digits.woff2')
const APP = path.resolve(__dirname, '..', 'miniprogram', 'app.js')

const buf = fs.readFileSync(SRC)
const b64 = buf.toString('base64')

const src = fs.readFileSync(APP, 'utf8')
const re = /(const NUMBER_FONT_DATA_URL =\s*\n\s*'data:font\/woff2;base64,' \+\s*\n\s*')([A-Za-z0-9+/=]+)(')/
if (!re.test(src)) {
  console.error('[fail] app.js 里没找到 NUMBER_FONT_DATA_URL 常量，请检查是否被改写')
  process.exit(1)
}
const out = src.replace(re, (m, a, _old, c) => a + b64 + c)
fs.writeFileSync(APP, out)
console.log(`[ok] app.js 已同步 Alkatra 子集  woff2=${(buf.length / 1024).toFixed(1)}KB  base64=${b64.length}字`)
