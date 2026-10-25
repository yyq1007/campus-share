"""
从 v4 高保真 PDF 中提取页面结构（不依赖视觉）：
- 文字：内容 / 坐标 / 字号 / 颜色 / 字体
- 矩形：位置 / 圆角 / 填充色 / 描边色（用于还原卡片、按钮、胶囊）
- 图片：位置与尺寸
按页输出 design-v4/extracted/pXX.txt（可读摘要）与 pXX.json（原始数据）
"""
import json
import os
import sys

import fitz  # PyMuPDF

SRC = sys.argv[1] if len(sys.argv) > 1 else r"E:\workbuddy\good finds WeChat\校园分享小程序-高保真交互稿-v4软萌手账风.pdf"
OUT = os.path.join(os.path.dirname(SRC), "design-v4", "extracted")
os.makedirs(OUT, exist_ok=True)


def hexcolor(c):
    if c is None:
        return "none"
    if isinstance(c, (int, float)):
        c = int(c)
        return "#%06X" % (c & 0xFFFFFF)
    return str(c)


def summarize(doc):
    lines = []
    for i, page in enumerate(doc):
        w, h = page.rect.width, page.rect.height
        lines.append("=" * 60)
        lines.append("PAGE %d  size=%.0fx%.0f" % (i + 1, w, h))

        data = {"page": i + 1, "size": [w, h], "text": [], "rects": [], "images": []}

        # 文字
        d = page.get_text("dict")
        for b in d.get("blocks", []):
            if b.get("type") != 0:
                continue
            for l in b.get("lines", []):
                for s in l.get("spans", []):
                    txt = s["text"].strip()
                    if not txt:
                        continue
                    x0, y0, x1, y1 = s["bbox"]
                    item = {
                        "text": txt,
                        "x": round(x0), "y": round(y0),
                        "w": round(x1 - x0), "h": round(y1 - y0),
                        "size": round(s["size"], 1),
                        "color": hexcolor(s["color"]),
                        "font": s["font"],
                    }
                    data["text"].append(item)
                    lines.append(
                        "TEXT  y=%4d x=%4d  %5.1fpx  %s  %s  | %s"
                        % (item["y"], item["x"], item["size"], item["color"], item["font"], txt[:40])
                    )

        # 矢量矩形（卡片/按钮/胶囊）
        for dr in page.get_drawings():
            for it in dr.get("items", []):
                if it[0] == "re":  # rect
                    r = it[1]
                    fill = hexcolor(dr.get("fill"))
                    stroke = hexcolor(dr.get("color"))
                    width = dr.get("width")
                    rect = {
                        "x": round(r.x0), "y": round(r.y0),
                        "w": round(r.width), "h": round(r.height),
                        "fill": fill, "stroke": stroke, "lw": width,
                    }
                    if rect["w"] < 2 or rect["h"] < 2:
                        continue
                    data["rects"].append(rect)
                    lines.append(
                        "RECT  y=%4d x=%4d  %4dx%-4d fill=%s stroke=%s lw=%s"
                        % (rect["y"], rect["x"], rect["w"], rect["h"], fill, stroke, width)
                    )

        # 位图
        for im in page.get_images(full=True):
            xref = im[0]
            try:
                rects = page.get_image_rects(xref)
                for r in rects:
                    data["images"].append({
                        "x": round(r.x0), "y": round(r.y0),
                        "w": round(r.width), "h": round(r.height),
                    })
                    lines.append("IMAGE y=%4d x=%4d  %4dx%-4d" % (round(r.y0), round(r.x0), round(r.width), round(r.height)))
            except Exception:
                pass

        with open(os.path.join(OUT, "p%02d.json" % (i + 1)), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        with open(os.path.join(OUT, "p%02d.txt" % (i + 1)), "w", encoding="utf-8") as f:
            f.write("\n".join(lines[-len(data["text"]) - len(data["rects"]) - len(data["images"]) - 2:]))

    with open(os.path.join(OUT, "all.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("pages=%d -> %s" % (len(doc), OUT))


doc = fitz.open(SRC)
summarize(doc)
