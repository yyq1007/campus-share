"""最终验证：JS 语法、WXML 标签平衡、CSS 花括号平衡、组件引用存在性。"""
import os
import re
import subprocess
import sys

ROOT = r"C:\Users\Admin（无密码）\Desktop\小程序\campus-share\miniprogram"
NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"

VOID = {"image", "input", "icon", "import", "include", "wxs", "block", "template",
        "switch", "checkbox", "radio", "slider", "progress", "canvas", "map", "video",
        "camera", "live-player", "live-pusher", "open-data", "web-view", "ad",
        "official-account", "audio", "textarea", "button", "label", "picker",
        "scroll-view", "swiper", "swiper-item", "view", "text", "navigator", "form",
        "movable-area", "movable-view", "cover-view", "cover-image", "rich-text",
        "picker-view", "picker-view-column", "checkbox-group", "radio-group",
        "editor", "functional-page-navigator", "page-meta", "navigation-bar",
        "keyboard-accessory", "match-media", "page-container", "share-element",
        "root-portal", "grid-view", "list-view", "sticky-header", "sticky-section"}

problems = []

def read(p):
    with open(p, encoding="utf-8", errors="replace") as fh:
        return fh.read()

# ---------- 1. JS 语法 ----------
print("=" * 70)
print("1. JS 语法检查")
print("=" * 70)
js_files = []
for dp, dn, fn in os.walk(ROOT):
    dn[:] = [d for d in dn if d not in ("node_modules", ".git")]
    for f in fn:
        if f.endswith(".js"):
            js_files.append(os.path.join(dp, f))
js_files.append(os.path.join(ROOT, "..", "app.js"))
bad_js = []
for p in js_files:
    if not os.path.exists(p):
        continue
    r = subprocess.run([NODE, "--check", p], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        bad_js.append((os.path.relpath(p, ROOT), (r.stderr or "")[:150]))
print(f"  检查 {len(js_files)} 个 js：{len(js_files)-len(bad_js)} 通过，{len(bad_js)} 失败")
for n, e in bad_js:
    print(f"    ❌ {n}: {e}")
    problems.append(n)

# ---------- 2. WXML 标签平衡 ----------
print()
print("=" * 70)
print("2. WXML 标签平衡检查")
print("=" * 70)

from html.parser import HTMLParser


class Balance(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.err = None

    def handle_starttag(self, tag, attrs):
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        pass  # 自闭合

    def handle_endtag(self, tag):
        if self.err:
            return
        if not self.stack:
            self.err = f"多余的 </{tag}>"
            return
        top = self.stack.pop()
        if top != tag:
            self.err = f"</{tag}> 与 <{top}> 不匹配"


wxml_files = []
for dp, dn, fn in os.walk(ROOT):
    dn[:] = [d for d in dn if d not in ("node_modules", ".git")]
    for f in fn:
        if f.endswith(".wxml"):
            wxml_files.append(os.path.join(dp, f))

bad_wxml = []
for p in wxml_files:
    src = read(p)
    src = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    b = Balance()
    try:
        b.feed(src)
        b.close()
    except Exception as e:
        bad_wxml.append((os.path.relpath(p, ROOT), f"解析异常 {e}"))
        continue
    if b.err:
        bad_wxml.append((os.path.relpath(p, ROOT), b.err))
    elif b.stack:
        bad_wxml.append((os.path.relpath(p, ROOT), "未闭合: " + ", ".join(b.stack[-4:])))
print(f"  检查 {len(wxml_files)} 个 wxml：{len(wxml_files)-len(bad_wxml)} 平衡，{len(bad_wxml)} 有问题")
for n, e in bad_wxml:
    print(f"    ❌ {n}: {e}")
    problems.append(n)
# ---------- 3. WXSS 花括号平衡 ----------
print()
print("=" * 70)
print("3. WXSS 花括号平衡")
print("=" * 70)
wxss_files = []
for dp, dn, fn in os.walk(ROOT):
    dn[:] = [d for d in dn if d not in ("node_modules", ".git")]
    for f in fn:
        if f.endswith(".wxss"):
            wxss_files.append(os.path.join(dp, f))
bad_wxss = []
for p in wxss_files:
    src = read(p)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    if src.count("{") != src.count("}"):
        bad_wxss.append((os.path.relpath(p, ROOT), src.count("{"), src.count("}")))
print(f"  检查 {len(wxss_files)} 个 wxss：{len(wxss_files)-len(bad_wxss)} 平衡，{len(bad_wxss)} 有问题")
for n, a, b in bad_wxss:
    print(f"    ❌ {n}: {{={a} }}={b}")
    problems.append(n)

# ---------- 4. 组件引用存在性 ----------
print()
print("=" * 70)
print("4. 组件引用与图片资源存在性")
print("=" * 70)
import json as _json

app_cfg = _json.loads(read(os.path.join(ROOT, "app.json")))
global_comps = set(app_cfg.get("usingComponents", {}).keys())
print(f"  app.json 全局注册组件: {', '.join(sorted(global_comps))}")

missing_refs = []
for p in wxml_files:
    src = read(p)
    json_p = p[:-5] + ".json"
    using = set()
    if os.path.exists(json_p):
        try:
            cfg = _json.loads(read(json_p))
        except Exception:
            cfg = {}
        using = set(cfg.get("usingComponents", {}).keys())
    available = using | global_comps

    # 模板里用到的自定义标签（带连字符的）
    used = set(re.findall(r"<([a-z]+-[a-z-]+)", src))
    skip = {"swiper-item", "scroll-view", "cover-view", "cover-image",
            "movable-area", "movable-view", "picker-view", "picker-view-column",
            "rich-text", "live-player", "live-pusher", "web-view", "open-data",
            "official-account", "functional-page-navigator", "page-meta",
            "navigation-bar", "keyboard-accessory", "match-media",
            "page-container", "share-element", "root-portal", "grid-view",
            "list-view", "sticky-header", "sticky-section", "checkbox-group",
            "radio-group"}
    for tag in used:
        if tag in skip:
            continue
        if tag not in available:
            missing_refs.append((os.path.relpath(p, ROOT), f"未注册组件 <{tag}>"))

    # 本地图片引用
    for m in re.finditer(r'src="(/assets/[^"{}]+)"', src):
        rel = m.group(1).lstrip("/")
        full = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.exists(full):
            missing_refs.append((os.path.relpath(p, ROOT), f"缺图 {m.group(1)}"))

if missing_refs:
    print(f"  ❌ {len(missing_refs)} 处缺失：")
    for n, e in missing_refs:
        print(f"    {n}: {e}")
        problems.append(n)
else:
    print("  ✅ 组件注册与图片资源引用完整")

print()
print("=" * 70)
if problems:
    print(f"❌ 有 {len(problems)} 个待处理问题")
    sys.exit(1)
print("✅ 全部检查通过")
