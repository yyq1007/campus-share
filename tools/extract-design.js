/**
 * 从 v4 高保真 PDF 提取页面结构（无需渲染/视觉）：
 * 逐页输出 文字(内容/坐标/字号/颜色) + 矩形(坐标/尺寸/填充) + 图片(坐标/尺寸)
 * 输出至 design-v4/extracted/pXX.txt
 */
const fs = require('fs')
const path = require('path')

const PDFJS = 'file:///C:/Users/YQ/.workbuddy/binaries/node/workspace/node_modules/pdfjs-dist/legacy/build/pdf.mjs'
const SRC = process.argv[2] || 'E:\\workbuddy\\good finds WeChat\\校园分享小程序-高保真交互稿-v4软萌手账风.pdf'
const OUT = path.join('E:\\workbuddy\\good finds WeChat', 'design-v4', 'extracted')

function rgb(arr) {
  if (!arr || arr.length < 3) return 'none'
  const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  return ('#' + h(arr[0]) + h(arr[1]) + h(arr[2])).toUpperCase()
}

;(async () => {
  const pdfjs = await import(PDFJS)
  const data = new Uint8Array(fs.readFileSync(SRC))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  fs.mkdirSync(OUT, { recursive: true })
  const all = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const H = vp.height
    const lines = [`======== PAGE ${p}  ${Math.round(vp.width)}x${Math.round(H)} ========`]

    // ---- 文字 + 颜色（颜色来自图形状态：文本前最近的填充色） ----
    const tc = await page.getTextContent()
    const ops = await page.getOperatorList()
    const OPS = pdfjs.OPS
    let fill = null
    const colorAt = []
    let pendingText = false
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      const args = ops.argsArray[i]
      if (fn === OPS.setFillRGBColor) fill = rgb(args)
      else if (fn === OPS.setFillColor) fill = rgb(args)
      if (fn === OPS.showText || fn === OPS.showSpacedText) {
        const t = Array.isArray(args) && typeof args[0] === 'string' ? args[0] : (args && args[0] && args[0].join ? args[0].join('') : '')
        if (t) colorAt.push({ t, c: fill })
      }
    }
    let ci = 0
    for (const it of tc.items) {
      const txt = (it.str || '').trim()
      if (!txt) continue
      const tr = it.transform
      const x = Math.round(tr[4])
      const y = Math.round(H - tr[5])          // 转左上原点
      const size = Math.round(Math.sqrt(tr[2] * tr[2] + tr[3] * tr[3]) * 10) / 10 || Math.round(it.height * 10) / 10
      let c = 'none'
      while (ci < colorAt.length) {
        const cur = colorAt[ci]
        if (cur.t.replace(/\s/g, '').startsWith(txt.replace(/\s/g, '').slice(0, 3)) || cur.t.includes(txt.slice(0, 2))) {
          c = cur.c; ci++; break
        }
        ci++
      }
      lines.push(`TEXT y=${String(y).padStart(4)} x=${String(x).padStart(4)} ${String(size).padStart(5)}px ${c} ${it.fontName || ''} | ${txt.slice(0, 44)}`)
    }

    // ---- 矩形（卡片/按钮/胶囊）----
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      const args = ops.argsArray[i]
      if (fn === OPS.constructPath && Array.isArray(args) && args[0] && Array.isArray(args[0])) {
        const ops2 = args[0]
        const pts = args[1] || []
        // 仅取 4 点闭合矩形
        const isRect = ops2.length === 3 && ops2[0] === pdfjs.OPS.moveTo && ops2[1] === pdfjs.OPS.lineTo && ops2[2] === pdfjs.OPS.closePath
        if (!isRect || pts.length < 8) continue
        const xs = [pts[0], pts[2], pts[4], pts[6]]
        const ys = [pts[1], pts[3], pts[5], pts[7]]
        const x0 = Math.min(...xs), x1 = Math.max(...xs)
        const y0 = Math.min(...ys), y1 = Math.max(...ys)
        const w = Math.round(x1 - x0), h = Math.round(y1 - y0)
        if (w < 3 || h < 3) continue
        const ty = Math.round(H - y1)  // 顶部（左上原点）
        const next = ['fill', 'stroke', 'eoFill'].some(() => true)
        lines.push(`RECT y=${String(ty).padStart(4)} x=${String(Math.round(x0)).padStart(4)} ${w}x${h}`)
      }
      if (fn === OPS.setFillRGBColor && args && args.length === 3) {
        // 标注最近一次填充色，供紧随其后的矩形引用
        lines.push(`FILL ${rgb(args)}`)
      }
    }

    fs.writeFileSync(path.join(OUT, `p${String(p).padStart(2, '0')}.txt`), lines.join('\n'), 'utf8')
    all.push(lines.join('\n'))
  }
  fs.writeFileSync(path.join(OUT, 'all.txt'), all.join('\n\n'), 'utf8')
  console.log('pages=' + doc.numPages + ' -> ' + OUT)
})().catch(e => { console.error(e); process.exit(1) })
