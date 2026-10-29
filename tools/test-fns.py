"""调用云函数并提取完整业务返回（从 Log 里的 Response 行解析）。"""
import json, re, subprocess, sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'qqq-d7g05y68803d5476c'


def invoke(fn, payload=None):
    args = [NODE, CLI, 'fn', 'invoke', fn, '-e', ENV, '--json']
    if payload:
        args += ['--params', json.dumps(payload, ensure_ascii=False)]
    p = subprocess.run(args, capture_output=True, text=True, timeout=300,
                       encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return '\n'.join(l for l in o.splitlines()
                     if 'shim' not in l and 'dirname' not in l)


def extract(out):
    """函数返回值在 RetMsg 字段（CLI invoke 的返回体）"""
    try:
        d = json.loads(out)
    except Exception:
        return out[:600]
    r = d.get('data', d)
    if not isinstance(r, dict):
        return str(r)[:600]
    ret = r.get('RetMsg')
    if ret:
        try:
            return json.dumps(json.loads(ret), ensure_ascii=False)
        except Exception:
            return str(ret)[:600]
    log = r.get('Log') or ''
    m = re.search(r'Response RequestId:[^\n]*?RetMsg:\s*(\{.*)', log)
    if m:
        return m.group(1)[:600]
    for k in ('Result', 'result', 'InvokeResult', 'ErrMsg'):
        if k in r:
            return f'{k}={r[k]}'
    return json.dumps(r, ensure_ascii=False)[:600]


TARGETS = [
    ('taskHotScore', {}),
    ('postList', {}),
    ('meOverview', {}),
    ('authLogin', {}),
    ('commentList', {}),
    ('askQuery', {}),
]

print('=== 云函数业务返回 ===\n')
for fn, payload in TARGETS:
    out = invoke(fn, payload)
    body = extract(out)
    print(f'--- {fn} ---')
    print(f'  {body[:700]}')
    print()
