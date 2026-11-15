/**
 * 生成 TabBar「榜单」图标（占位版）：tab-rank.* / tab-rank-on.*
 *
 * 纯 Node 实现，无第三方依赖（zlib 内置）：4x 超采样 + 距离场描边 → 手写 PNG 编码。
 * 造型参考用户提供的图标集（细线条线性风）：奖杯 —— 碗形杯身 + 两侧半圆把手 + 底座。
 * 规格与现有 tab 图标一致：48 单位 viewBox、描边 3、输出 144×144（3x）。
 * 颜色：未选中 #6B6780、选中 #5A47C9。
 *
 * 用法：node tools/gen-tab-rank-icon.js
 * 注意：设计稿正式出图后直接替换 assets/icons/tab-rank*.png 即可，无需改代码。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'miniprogram', 'assets', 'icons');
const UNIT = 3;
const SIZE = 48 * UNIT;
const SS = 4;

const STROKE = 3;
const HALF = STROKE / 2;

// ---------- 几何：线段 + 圆弧 ----------
const SEGS = [
  [14, 9, 34, 9],      // 杯口上沿
  [14, 9, 16.5, 23],   // 左壁
  [34, 9, 31.5, 23],   // 右壁
  [24, 30.5, 24, 36],  // 底座竖杆
  [17, 38, 31, 38],    // 底座横线
];

const ARCS = [
  { cx: 24, cy: 23, r: 7.5, a0: 0, a1: Math.PI },               // 杯底下半圆
  // 把手：圆心落在杯壁线上，使弧的两端正好搭在杯身上（否则会悬空成 C 形）
  // cy 略低于杯口、半径小于杯身半宽，避免把手顶部冒出杯沿
  { cx: 15.1, cy: 16, r: 4.5, a0: Math.PI / 2, a1: Math.PI * 1.5 }, // 左把手（凸向左）
  { cx: 32.9, cy: 16, r: 4.5, a0: -Math.PI / 2, a1: Math.PI / 2 },  // 右把手（凸向右）
];

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inArcRange(a, a0, a1) {
  let x = a;
  while (x < a0) x += Math.PI * 2;
  while (x > a0 + Math.PI * 2) x -= Math.PI * 2;
  return x <= a1;
}

function distArc(px, py, arc) {
  const { cx, cy, r, a0, a1 } = arc;
  const dx = px - cx;
  const dy = py - cy;
  if (inArcRange(Math.atan2(dy, dx), a0, a1)) return Math.abs(Math.hypot(dx, dy) - r);
  const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
  const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  return Math.min(Math.hypot(px - p0[0], py - p0[1]), Math.hypot(px - p1[0], py - p1[1]));
}

function hit(ux, uy) {
  for (let i = 0; i < SEGS.length; i += 1) {
    const s = SEGS[i];
    if (distSeg(ux, uy, s[0], s[1], s[2], s[3]) <= HALF) return true;
  }
  for (let i = 0; i < ARCS.length; i += 1) {
    if (distArc(ux, uy, ARCS[i]) <= HALF) return true;
  }
  return false;
}

function render([r, g, b]) {
  const buf = Buffer.alloc(SIZE * SIZE * 4, 0);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const ux = (x + (sx + 0.5) / SS) / UNIT;
          const uy = (y + (sy + 0.5) / SS) / UNIT;
          if (hit(ux, uy)) acc += 1;
        }
      }
      const a = Math.round((acc / (SS * SS)) * 255);
      const i = (y * SIZE + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return buf;
}

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, w, h) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- SVG（与 PNG 同几何，便于后续改色/改形） ----------
function svg(color) {
  const segs = SEGS.map((s) => `<path d="M${s[0]} ${s[1]} L${s[2]} ${s[3]}"/>`).join('');
  const arcs = ARCS.map((a) => {
    const x0 = (a.cx + a.r * Math.cos(a.a0)).toFixed(2);
    const y0 = (a.cy + a.r * Math.sin(a.a0)).toFixed(2);
    const x1 = (a.cx + a.r * Math.cos(a.a1)).toFixed(2);
    const y1 = (a.cy + a.r * Math.sin(a.a1)).toFixed(2);
    return `<path d="M${x0} ${y0} A${a.r} ${a.r} 0 0 1 ${x1} ${y1}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><g fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${segs}${arcs}</g></svg>\n`;
}

const JOBS = [
  { base: 'tab-rank', color: '#6B6780', rgb: [107, 103, 128] },
  { base: 'tab-rank-on', color: '#5A47C9', rgb: [90, 71, 201] },
];

JOBS.forEach((job) => {
  fs.writeFileSync(path.join(OUT, `${job.base}.png`), encodePng(render(job.rgb), SIZE, SIZE));
  fs.writeFileSync(path.join(OUT, `${job.base}.svg`), svg(job.color), 'utf8');
  console.log('generated', job.base);
});
