/**
 * 把子集化 woff2 转成 base64 Data URL，产出 utils/font-data.js
 * 背景：wx.loadFontFace 的 source 只支持 https 链接或 Data URL（不支持包内路径）；
 *      云存储 CDN 未开 CORS（且需 servicewechat.com 来源），云端链路不可用。
 *      Data URL 内嵌 = 零网络、零 CORS、首屏字体立即可用。
 * 用法：node tools/build-font-data.js
 * 注意：重建字体（tools/build-font.py）后必须重跑本脚本同步 font-data.js。
 */
const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', 'miniprogram', 'assets', 'zcool-kuaile-subset.woff2')
const OUT = path.resolve(__dirname, '..', 'miniprogram', 'utils', 'font-data.js')

const buf = fs.readFileSync(SRC)
const b64 = buf.toString('base64')
const dataUrl = `data:font/woff2;base64,${b64}`

const content = `/**
 * 站酷快乐体子集 woff2 的 base64 Data URL（由 tools/build-font-data.js 自动生成，勿手改）
 * 源文件：assets/zcool-kuaile-subset.woff2（重建字体后重跑脚本同步此文件）
 * 供 app.js 的 wx.loadFontFace 使用：source 仅支持 https 或 Data URL，包内路径不被支持。
 */
module.exports = '${dataUrl}'
`
fs.writeFileSync(OUT, content)
console.log(`[ok] ${path.relative(process.cwd(), OUT)}  woff2=${(buf.length / 1024).toFixed(1)}KB  dataURL=${(Buffer.byteLength(content) / 1024).toFixed(1)}KB`)
