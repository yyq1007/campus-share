#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成首页「周报」按钮的两个渐变字 PNG（周 / 报）。

为什么要烘焙成 PNG：
  background-clip:text 在小程序 <text> 上不生效（会把背景画成实心块），
  所以把「字形 + 渐变」一起在本地栅格化。

为什么要用同一份字体、同一个 scale：
  两个字若各自按自己裁切出的 bbox 拉伸到固定盒子，字号会被隐式放大/缩小，
  视觉上就成了「两个字大小不一样」。这里以 font unit 为唯一基准，两字共用
  一个 scale，只让宽高按各自字形包围盒比例变化，WXSS 里照抄输出的 rpx。

字体：assets-font/SmileySans-Oblique-subset.ttf（得意黑斜体，仅含周/报两字）
  来源 cn-fontsource-smiley-sans-oblique-regular 分块：
    周 U+5468 → L1_543c_192.woff2
    报 U+62A5 → L1_60d2_192.woff2

用法：
  python tools/build-digest-chars.py
  node tools/raster-digest-chars.js      # SVG → PNG（需 NODE_PATH 指向 sharp）
输出：
  miniprogram/assets/icons/digest-{zhou,bao}.svg/.png
  tools/digest-chars.json（生成的 PNG 尺寸与应写入 WXSS 的 rpx）
"""
import argparse
import json
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

# 周字的字形高（font unit）对应的 rpx 字号。
# 按设计稿实测：白椭圆 50×60rpx、周字墨迹 42.6×52.2rpx → 取 52.2。
# 字略大于椭圆的视觉内切宽度，左右各有 ~3.6rpx，与设计稿「字出圆」一致
TARGET_H_RPX = 52.2
BASE_H_UNITS = 936.0  # 周 bbox 高（unit），作为 1:1 基准

# 每个字的垂直渐变（设计稿取样，top → bottom）
CHARS = [
    ('周', '#9BE9FD', '#4DBAF8', 'digest-zhou'),
    ('报', '#66BEFC', '#2E80C6', 'digest-bao'),
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'miniprogram', 'assets', 'icons')
DEFAULT_FONT = os.path.join(ROOT, 'assets-font', 'SmileySans-Oblique-subset.ttf')
PX_PER_RPX = 4.0  # PNG 像素 = 4 × rpx（1 CSS px = 2rpx → 8x 超采样）


def build(font_path):
    font = TTFont(font_path)
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    s_rpx = TARGET_H_RPX / BASE_H_UNITS  # font unit → rpx
    meta = []
    for ch, c_top, c_bottom, name in CHARS:
        gname = cmap.get(ord(ch))
        if not gname:
            raise SystemExit(f'字体缺少字形 {ch}，请先按文件头注释合并分块 woff2')
        bp = BoundsPen(gs)
        gs[gname].draw(bp)
        x0, y0, x1, y1 = bp.bounds

        pen = SVGPathPen(gs)
        gs[gname].draw(pen)

        w_u, h_u = x1 - x0, y1 - y0
        w_rpx, h_rpx = w_u * s_rpx, h_u * s_rpx
        w_px, h_px = round(w_rpx * PX_PER_RPX), round(h_rpx * PX_PER_RPX)

        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w_px}" height="{h_px}" '
            f'viewBox="0 0 {w_u:.2f} {h_u:.2f}">'
            f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{c_top}"/>'
            f'<stop offset="1" stop-color="{c_bottom}"/>'
            f'</linearGradient></defs>'
            f'<g transform="translate({-x0:.2f},{y1:.2f}) scale(1,-1)">'
            f'<path d="{pen.getCommands()}" fill="url(#g)"/></g></svg>'
        )
        with open(os.path.join(OUT_DIR, name + '.svg'), 'w', encoding='utf-8') as f:
            f.write(svg)

        meta.append({'char': ch, 'name': name, 'w_px': w_px, 'h_px': h_px,
                     'w_rpx': round(w_rpx, 1), 'h_rpx': round(h_rpx, 1)})
        print(f'{ch}  bbox={bp.bounds}  -> png {w_px}x{h_px}  css {w_rpx:.1f}x{h_rpx:.1f}rpx')

    with open(os.path.join(ROOT, 'tools', 'digest-chars.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--font', default=DEFAULT_FONT)
    build(ap.parse_args().font)
