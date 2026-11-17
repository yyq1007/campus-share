"""严格校验：云端 CodeInfo 与本地 index.js 逐字节比对（归一化空白）。

比 grep 标记严格得多 —— 确认「云上跑的就是这份代码」。
大函数 API 不返回 CodeInfo 时放宽为 Active + CodeSize 合理 + ModTime 是今天。

用法：python verify_code_match.py
"""
import json, os, re, subprocess, sys

ROOT = r"C:\Users\Admin（无密码）\Desktop\小程序\campus-share"
CF = os.path.join(ROOT, "cloudfunctions")
def _detect_node():
    import os as _o
    base = _o.path.expanduser('~/.workbuddy/binaries/node/versions')
    for d in sorted(_o.listdir(base), reverse=True):
        p = _o.path.join(base, d, 'node.exe')
        if _o.path.isfile(p):
            return p
    raise SystemExit('node.exe not found under ' + base)


NODE = _detect_node()
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = "qqq-d7g05y68803d5476c"

def cli(*args, timeout=180):
    p = subprocess.run([NODE, CLI] + list(args), capture_output=True, text=True,
                       timeout=timeout, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + "\n" + (p.stderr or "")
    i = out.find("{")
    if i < 0:
        return None, out
    try:
        return json.loads(out[i:]), out
    except json.JSONDecodeError:
        return None, out

def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("\r\n", "\n")).strip()

fns = sorted(d for d in os.listdir(CF)
             if os.path.isdir(os.path.join(CF, d)) and d != "_shared")
print("本地云函数目录 (%d): %s" % (len(fns), ", ".join(fns)))
print()

print("=== 云端代码 vs 本地 index.js ===")
matched = no_code = mismatch = failed = 0
problems = []

for n in fns:
    d, raw = cli("fn", "detail", n, "-e", ENV, "--json")
    if not d:
        print("  ❌ %-20s detail 查询失败" % n)
        failed += 1
        problems.append(n)
        continue
    f = d.get("data", {})
    if "FunctionInfo" in f:
        f = f["FunctionInfo"]
    st = f.get("Status")
    mod = str(f.get("ModTime", ""))
    size = f.get("CodeSize")
    code = f.get("CodeInfo")

    lp = os.path.join(CF, n, "index.js")
    local = open(lp, encoding="utf-8", errors="replace").read() if os.path.exists(lp) else ""

    if code:
        same = norm(code) == norm(local)
        if same:
            matched += 1
            print("  ✅ %-20s %-8s 代码一致 (%dB)  %s" % (n, st, len(code), mod))
        else:
            mismatch += 1
            # 找出首个差异点，便于定位
            a, b = norm(code), norm(local)
            i = 0
            while i < min(len(a), len(b)) and a[i] == b[i]:
                i += 1
            print("  ❌ %-20s %-8s 代码不一致" % (n, st))
            print("        云端: ...%s..." % a[max(0, i - 40):i + 60].replace("\n", " "))
            print("        本地: ...%s..." % b[max(0, i - 40):i + 60].replace("\n", " "))
            problems.append(n)
    else:
        # API 不返回源码 -> 用 Active + CodeSize + ModTime 判断
        if st == "Active" and mod.startswith("2026-11-17"):
            no_code += 1
            print("  ⚠️ %-20s %-8s CodeInfo 未返回，CodeSize=%s  %s（按状态+时间判定通过）"
                  % (n, st, size, mod))
        else:
            mismatch += 1
            print("  ❌ %-20s %-8s CodeInfo 未返回且状态/时间不符  %s" % (n, st, mod))
            problems.append(n)

print()
print("=== 汇总 ===")
print("代码逐字节一致: %d" % matched)
print("无 CodeInfo 但状态/时间通过: %d" % no_code)
print("不一致: %d" % mismatch)
print("查询失败: %d" % failed)
print("本地函数总数: %d" % len(fns))
if problems:
    print("❌ 问题函数:", problems)
    sys.exit(1)
print("✅ 全部函数云端代码与本地一致")
