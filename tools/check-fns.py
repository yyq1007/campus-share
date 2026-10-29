"""核实云上 26 个云函数的状态（逐个用 fn detail 查，不依赖分页列表）。"""
import json, subprocess, sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'yyq-d6g1dv0kgf893afe8'

NEED = ['adminQueue', 'adminReview', 'aiEmbed', 'aiStructure', 'askQuery',
        'authBindInvite', 'authDelete', 'authLogin', 'clientLog', 'commentCreate',
        'commentList', 'interactionToggle', 'meList', 'meMessageRead', 'meOverview',
        'meUpdateProfile', 'mediaCheck', 'postCreate', 'postDelete', 'postDetail',
        'postList', 'reportCreate', 'taskCleanup', 'taskHotScore', 'taskVectorize',
        'wxacodeGen']


def detail(name):
    p = subprocess.run([NODE, CLI, 'fn', 'detail', name, '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=180,
                       encoding='utf-8', errors='replace')
    o = '\n'.join(l for l in (p.stdout or '').splitlines()
                  if 'shim' not in l and 'dirname' not in l)
    try:
        d = json.loads(o)
        if '"error"' in o:
            return None, d['error'].get('message', '')[:90]
        # fn detail 直接返回函数信息，无 FunctionInfo 包装层
        f = d.get('data', d)
        if 'FunctionInfo' in f:
            f = f['FunctionInfo']
        return f, ''
    except Exception as e:
        return None, f'parse {e}'


print('=== 云上 26 个函数状态（逐个 fn detail 核实）===\n')
ok, bad = 0, []
env_ok = 0
for n in NEED:
    f, err = detail(n)
    if not f:
        bad.append(f'{n}: {err}')
        print(f'  ❌ {n:20s} {err}')
        continue
    st = f.get('Status') or f.get('AvailableStatus')
    rt = f.get('Runtime')
    ev = f.get('Environment', {}).get('Variables', []) or []
    envd = {v.get('Key'): v.get('Value') for v in ev}
    mod = envd.get('MODERATION_MODE')
    if mod == 'strict':
        env_ok += 1
    good = st == 'Active'
    if good:
        ok += 1
    else:
        bad.append(f'{n}({st})')
    print(f'  [{"✅" if good else "❌"}] {n:20s} {st:8s} {rt:14s} '
          f'MODERATION_MODE={mod or "(未设)"}')

print()
print(f'=== 汇总：Active {ok}/{len(NEED)} ｜ MODERATION_MODE=strict {env_ok}/{len(NEED)} ===')
if bad:
    print('  异常:', bad)
sys.exit(1 if bad else 0)
