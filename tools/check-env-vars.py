"""复核云函数环境变量：确认没有 DEV_OPENID 残留，且 MODERATION_MODE=strict。"""
import json, subprocess
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
        return None
    try:
        return json.loads(out[i:])
    except json.JSONDecodeError:
        return None

d = cli("fn", "list", "-e", ENV, "--limit", "60", "--json")
data = d.get("data", d)
fns = data.get("FunctionList") or data.get("Functions") or []
names = sorted(f.get("FunctionName") for f in fns)

bad = []
print("=== 环境变量复核（Environment.Variables 是 list[{Key,Value}]）===")
for n in names:
    d2 = cli("fn", "detail", n, "-e", ENV, "--json")
    if not d2:
        print(f"  ? {n}: detail 失败")
        bad.append(n)
        continue
    f = d2.get("data", {})
    if "FunctionInfo" in f:
        f = f["FunctionInfo"]
    # Environment.Variables 是 list[{Key,Value}]，不是 dict
    envvars = f.get("Environment", {}).get("Variables") or []
    kv = {}
    if isinstance(envvars, list):
        for item in envvars:
            if isinstance(item, dict) and "Key" in item:
                kv[item["Key"]] = item.get("Value")
    keys = sorted(kv.keys())
    flags = []
    if "DEV_OPENID" in kv:
        flags.append("!! DEV_OPENID 残留")
    if kv.get("MODERATION_MODE") != "strict":
        flags.append("!! MODERATION_MODE=%r" % kv.get("MODERATION_MODE"))
    runtime = f.get("Runtime")
    if runtime != "Nodejs18.15":
        flags.append("!! runtime=%s" % runtime)
    if flags:
        print("  ❌ %-20s %s  keys=%s" % (n, " ".join(flags), keys))
        bad.append(n)
    else:
        print("  ✅ %-20s %s  keys=%s" % (n, runtime, keys))

print()
if bad:
    print("❌ 有问题的函数:", bad)
else:
    print("✅ 全部 %d 个函数：无 DEV_OPENID 残留，MODERATION_MODE=strict，runtime=Nodejs18.15" % len(names))
