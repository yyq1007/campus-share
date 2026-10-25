/**
 * 从矢量型 PDF 还原版式几何（文字已被转曲，取不到文案）：
 * 输出 矩形/圆角矩形/胶囊/椭圆 的 坐标、尺寸、圆角、填充色、描边色、线宽
 * 排序按 y 再 x，便于逐块比对实现代码中的 rpx 数值。
 */
const fs = require('fs')
const path = require('path')

const PDFJS = 'file:///C:/Users/YQ/.workbuddy/binaries/node/workspace/node_modules/pdfjs-dist/legacy/build/pdf.mjs'
const SRC = process.argv[2] || 'E:\\workbuddy\\good finds WeChat\\校园分享小程序-高保真交互稿-v4软萌手账风.pdf'
const OUT = path.join('E:\\workbuddy\\good finds WeChat', 'design-v4', 'extracted')

function rgb(args) {
  if (!args) return 'none'
  const a = Array.isArray(args) && Array.isArray(args[0]) ? args[0] : args
  if (!Array.isArray(a) || a.length < 3) return 'none'
  const h = v => Math.round(Math.max(0, Math.min(1, Number(v))) * 255).toString(16).padStart(2, '0')
  return ('#' + h(a[0]) + h(a[1]) + h(a[2])).toUpperCase()
}

;(async () => {
  const pdfjs = await import(PDFJS)
  const OPS = pdfjs.OPS
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(SRC)) }).promise
  fs.mkdirSync(OUT, { recursive: true })

  const all = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const H = page.getViewport({ scale: 1 }).height
    const ops = await page.getOperatorList()
    let fill = 'none', stroke = 'none', lw = 0
    const shapes = []

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      const args = ops.argsArray[i] || []
      if (fn === OPS.setFillRGBColor) { fill = rgb(args); continue }
      if (fn === OPS.setStrokeRGBColor) { stroke = rgb(args); continue }
      if (fn === OPS.setFillColorN) {
        const a = Array.isArray(args[0]) ? args[0] : args
        fill = (args[0] === 'Shading' || (a && a[0] === 'Shading')) ? 'GRADIENT' : rgb(a.slice(a.length - 3))
        continue
      }
      if (fn === OPS.setStrokeColorN) {
        const a = Array.isArray(args[0]) ? args[0] : args
        stroke = (args[0] === 'Shading' || (a && a[0] === 'Shading')) ? 'GRADIENT' : rgb(a.slice(a.length - 3))
        continue
      }
      if (fn === OPS.setLineWidth) { lw = args[0]; continue }

      if (fn === OPS.constructPath) {
        // pdfjs: args[1][0] = Float32Array，按 [flag,x,y] 编码：0=M 1=L 2=C(6数) 4=闭合
        const coords = (args[1] && args[1][0]) ? Array.from(args[1][0]) : []
        const segs = []
        let k = 0
        while (k < coords.length) {
          const f = coords[k++]
          if (f === 0) { segs.push({ t: 'M', p: [coords[k], coords[k + 1]] }); k += 2 }
          else if (f === 1) { segs.push({ t: 'L', p: [coords[k], coords[k + 1]] }); k += 2 }
          else if (f === 2) { segs.push({ t: 'C', p: [coords[k], coords[k + 1], coords[k + 2], coords[k + 3], coords[k + 4], coords[k + 5]] }); k += 6 }
          else if (f === 3) { segs.push({ t: 'Q', p: [coords[k], coords[k + 1], coords[k + 2], coords[k + 3]] }); k += 4 }
          else if (f === 4) { segs.push({ t: 'Z' }) }
          else break
        }
        const xs = [], ys = []
        for (const s of segs) {
          if (!s.p) continue
          for (let j = 0; j < s.p.length; j += 2) { xs.push(s.p[j]); ys.push(s.p[j + 1]) }
        }
        if (!xs.length) continue
        const x0 = Math.min(...xs), x1 = Math.max(...xs)
        const y0 = Math.min(...ys), y1 = Math.max(...ys)
        const w = x1 - x0, h = y1 - y0
        if (w < 4 || h < 4) continue

        const kinds = segs.map(s => s.t).join('')
        const isRect = /^ML+L+Z$/.test(kinds) && segs.filter(s => s.t === 'L').length === 3
        const isRound = kinds.startsWith('M') && kinds.includes('C') && kinds.endsWith('Z')
        // 圆角半径：取首个 C 的控制点偏移
        let r = 0
        if (isRound) {
          const first = segs.find(s => s.t === 'C')
          const prev = segs[segs.indexOf(first) - 1]
          if (prev && prev.p) r = Math.round(Math.abs(first.p[0] - prev.p[0]) || Math.abs(first.p[1] - prev.p[1]))
        }
        const isEllipse = isRound && segs.filter(s => s.t === 'C').length === 4 && Math.abs(w - h) <= 2

        // 后续填充/描边归属（颜色可能在 constructPath 之后才设置）
        let f = null, st = null
        for (let j = i + 1; j < Math.min(i + 12, ops.fnArray.length); j++) {
          const fj = ops.fnArray[j], aj = ops.argsArray[j] || []
          if (fj === OPS.setFillRGBColor) { f = rgb(aj); continue }
          if (fj === OPS.setFillColorN) {
            const a = Array.isArray(aj[0]) ? aj[0] : aj
            f = (aj[0] === 'Shading' || (a && a[0] === 'Shading')) ? 'GRADIENT' : rgb(a.slice(a.length - 3)); continue
          }
          if (fj === OPS.setStrokeRGBColor) { st = rgb(aj); continue }
          if (fj === OPS.setStrokeColorN) {
            const a = Array.isArray(aj[0]) ? aj[0] : aj
            st = (aj[0] === 'Shading' || (a && a[0] === 'Shading')) ? 'GRADIENT' : rgb(a.slice(a.length - 3)); continue
          }
          if (fj === OPS.setLineWidth) { lw = aj[0]; continue }
          if (fj === OPS.fill || fj === OPS.eoFill) { f = f || fill; break }
          if (fj === OPS.stroke) { st = st || stroke; break }
          if (fj === OPS.constructPath) break
        }
        if (!f && !st) continue
        f = f || 'none'; st = st || 'none'

        shapes.push({
          // PDF 导出为左上原点：顶部 = min(ys)
          y: Math.round(y0), x: Math.round(x0),
          w: Math.round(w), h: Math.round(h), r,
          kind: isEllipse ? 'circle' : (isRound ? (Math.min(w, h) <= 2 * r + 2 ? 'capsule' : 'rrect') : (isRect ? 'rect' : 'path')),
          fill: f, stroke: st, lw: lw || 0
        })
      }
    }

    shapes.sort((a, b) => (a.y - b.y) || (a.x - b.x))
    const lines = [`======== PAGE ${p}  375x${Math.round(H)}  shapes=${shapes.length} ========`]
    for (const s of shapes) {
      lines.push(`${s.kind.padEnd(7)} y=${String(s.y).padStart(3)} x=${String(s.x).padStart(3)} ${String(s.w).padStart(3)}x${String(s.h).padStart(3)} r=${String(s.r).padStart(2)} fill=${s.fill} stroke=${s.stroke} lw=${s.lw}`)
    }
    fs.writeFileSync(path.join(OUT, `geo-p${String(p).padStart(2, '0')}.txt`), lines.join('\n'), 'utf8')
    all.push(lines.join('\n'))
  }
  fs.writeFileSync(path.join(OUT, 'geo-all.txt'), all.join('\n\n'), 'utf8')
  console.log('done pages=' + doc.numPages)
})().catch(e => { console.error(e); process.exit(1) })
