"""全量事件绑定审计：wxml 里每个 bind*/catch* 都要在对应 js 里有处理方法。

这是防「点了没反应」的关键检查——改 WXML 时最容易漏掉/改错 handler 名。
"""
import os
import re
import sys

ROOT = r"C:\Users\Admin（无密码）\Desktop\小程序\campus-share\miniprogram"

# 事件属性：bindtap / bind:tap / catchtap / catch:tap / capture-bind:tap ...
EVENT_RE = re.compile(
    r"(?:capture-)?(?:bind|catch|mut-bind):?(?:tap|longpress|longtap|input|confirm|blur|focus|"
    r"change|submit|reset|scroll|scrolltolower|scrolltoupper|load|error|touchstart|touchmove|"
    r"touchend|touchcancel|animationend|transitionend|keyboardheightchange|linechange|"
    r"columnchange|getphonenumber|getuserinfo|opensetting|contact|chooseavatar|"
    r"play|pause|ended|timeupdate|waiting|progress|loadedmetadata|fullscreenchange|"
    r"nicknamereview)\s*=\s*\"([^\"]*)\""
)

def read(p):
    with open(p, encoding="utf-8", errors="replace") as fh:
        return fh.read()

def collect_js_handlers(js_path, is_component):
    """粗略但够用地提取方法名：顶层 `name(` 与 methods 块内 `name(`。"""
    if not os.path.exists(js_path):
        return None, "js not found"
    src = read(js_path)
    names = set()

    # 所有 `标识符 (` 形式的方法定义（含 async）
    for m in re.finditer(r"(?:^|\n)\s{0,4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", src):
        names.add(m.group(1))

    # 方法定义与方法名挤在同一行的情况（如上游 `*/  async onXxx() {`）
    for m in re.finditer(r"(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", src):
        name = m.group(1)
        if name not in ("if", "for", "while", "switch", "catch", "function", "return", "typeof"):
            names.add(name)

    # 箭头函数赋值形式：name: (e) => {}  或  name: function(e) {}
    for m in re.finditer(r"(?:^|\n)\s{0,4}([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\s*)?\(", src):
        names.add(m.group(1))

    # 对象字面量键：xxx: function
    for m in re.finditer(r"([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function", src):
        names.add(m.group(1))

    return names, None

def collect_js_data_keys(js_path):
    """提取 data: { ... } 的顶层键名（用于检查模板引用）。"""
    if not os.path.exists(js_path):
        return set()
    src = read(js_path)
    keys = set()
    m = re.search(r"\bdata\s*:\s*\{", src)
    if not m:
        return keys
    i = m.end()
    depth = 1
    while i < len(src) and depth:
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        i += 1
    body = src[m.end():i - 1]
    # 仅取 depth 0 层的键
    depth = 0
    for mm in re.finditer(r"[{}\[\]]|(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*:", body):
        tok = mm.group(0)
        if tok in "{}[]":
            depth += 1 if tok in "{[" else -1
        elif mm.group(1) and depth == 0:
            keys.add(mm.group(1))
    return keys

print("=" * 78)
print("事件绑定审计（wxml → js handler 对账）")
print("=" * 78)

total_events = 0
problems = []

# 遍历所有页面与组件
targets = []
for dp, dn, fn in os.walk(ROOT):
    dn[:] = [d for d in dn if d not in ("node_modules", ".git")]
    for f in fn:
        if f.endswith(".wxml"):
            wxml = os.path.join(dp, f)
            base = wxml[:-5]
            js = base + ".js"
            targets.append((wxml, js, os.path.basename(f)))

for wxml, js, name in sorted(targets):
    src = read(wxml)
    is_comp = "/components/" in wxml.replace("\\", "/") or os.path.basename(js).startswith(("icon", "post-card", "page-state", "privacy-gate", "nav-bar"))
    handlers, err = collect_js_handlers(js, is_comp)
    rel = os.path.relpath(wxml, ROOT)

    events = []
    for m in EVENT_RE.finditer(src):
        val = m.group(1).strip()
        if not val:
            continue
        attr = m.group(0).split("=")[0].strip()
        # 模板表达式（如 bind:tap="{{handler}}"）跳过静态检查
        if "{{" in val:
            events.append((attr, val, True))
            continue
        events.append((attr, val, False))

    if not events:
        continue
    total_events += len(events)

    if handlers is None:
        problems.append((rel, "-", f"找不到 js: {err}"))
        continue

    missing = []
    for attr, val, dynamic in events:
        if dynamic:
            continue
        if val not in handlers:
            missing.append((attr, val))

    if missing:
        # 也可能是引用了组件方法（如 post-card 的 onPreview 由内部处理）
        for attr, val in missing:
            problems.append((rel, attr, val))

print(f"\n共扫描 {len(targets)} 个 wxml，{total_events} 个事件绑定")
print()
if problems:
    print(f"❌ 发现 {len(problems)} 处疑似缺失 handler：")
    for rel, attr, val in problems:
        print(f"   {rel:<52} {attr:<22} -> {val}")
else:
    print("✅ 所有事件绑定都能在对应 js 中找到处理方法")

print()
print("=" * 78)
print("模板引用 data 字段审计（仅提示，不阻断）")
print("=" * 78)

warn = 0
for wxml, js, name in sorted(targets):
    src = read(wxml)
    keys = collect_js_data_keys(js)
    if not keys:
        continue
    rel = os.path.relpath(wxml, ROOT)
    # 只抽 {{ xxx }} 里的裸标识符（取 . 前缀）
    refs = set()
    for m in re.finditer(r"\{\{([^}]*)\}\}", src):
        for ident in re.finditer(r"(?<![\w.$])([A-Za-z_$][\w$]*)", m.group(1)):
            refs.add(ident.group(1))
    # 过滤关键字与常见内置
    builtin = {"true", "false", "null", "undefined", "length", "index", "item", "this"}
    unknown = sorted(r for r in refs if r not in keys and r not in builtin
                     and not r.startswith("item") and r not in ("wx",))
    if unknown:
        warn += 1
        if warn <= 12:
            print(f"   {rel}: {', '.join(unknown[:8])}")
print(f"\n（{warn} 个文件有未在 data 中直接声明的引用——多为 wxml 局部变量 wx:for-item，属正常）")

sys.exit(1 if problems else 0)
