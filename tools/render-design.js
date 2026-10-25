/**
 * 把 v4 设计稿 PDF 逐页渲染为 PNG（pdfjs + @napi-rs/canvas），供逐屏视觉比对
 * 输出：design-v4/pages/pNN.png
 */
const fs = require('fs')
const path = require('path')
const { createCanvas } = require('@napi-rs/canvas')

const PDFJS = 'file:///C:/Users/YQ/.workbuddy/binaries/node/workspace/node_modules/pdfjs-dist/legacy/build/pdf.mjs'
const SRC = 'E:\\workbuddy\\good finds WeChat\\校园分享小程序-高保真交互稿-v4软萌手账风.pdf'
const OUT = path.join('E:\\workbuddy\\good finds WeChat', 'design-v4', 'pages')

;(async () => {
  const pdfjs = await import(PDFJS)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(SRC)) }).promise
  fs.mkdirSync(OUT, { recursive: true })
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    fs.writeFileSync(path.join(OUT, `p${String(p).padStart(2, '0')}.png`), canvas.toBuffer('image/png'))
    console.log('rendered p' + p)
  }
  console.log('-> ' + OUT)
})().catch(e => { console.error(e); process.exit(1) })
