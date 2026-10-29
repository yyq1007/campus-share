"""全量回归验证：语法 + 静态校验 + 配置一致性 + 新增文件检查。"""
import json
import os
import re
import subprocess
import sys

ROOT = r"C:\Users\Admin（无密码）\WorkBuddy\2026-10-26-10-38-44\campus-share"
NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

fail = 0


def check(title, ok, detail=''):
    global fail
    mark = 'PASS' if ok else 'FAIL'
    if not ok:
        fail += 1
    print(f'  [{mark}] {title}' + (f'  {detail}' if detail else ''))


print('=== 1. 全量 JS 语法检查 ===')
files = []
for r, d, fs in os.walk(ROOT):
    d[:] = [x for x in d if x not in ('.git', 'node_modules', '_cloudfunctions_old_backup')]
    for f in fs:
        if f.endswith('.js'):
            files.append(os.path.join(r, f))
bad = []
for f in files:
    p = subprocess.run([NODE, '--check', f], capture_output=True, text=True, timeout=60,
                       encoding='utf-8', errors='replace')
    if p.returncode != 0:
        bad.append(os.path.relpath(f, ROOT))
check(f'{len(files)} 个 JS 文件语法', not bad, f'错误 {len(bad)}: {bad[:5]}' if bad else '0 错误')

print()
print('=== 2. 作者静态校验器 ===')
p = subprocess.run([NODE, os.path.join(ROOT, 'tools', 'static-check.js')], cwd=ROOT,
                   capture_output=True, text=True, timeout=240,
                   encoding='utf-8', errors='replace')
out = (p.stdout or '').strip()
m = re.search(r'共\s*(\d+)\s*处问题', out)
check('static-check', p.returncode == 0 and (not m or m.group(1) == '0'), out.splitlines()[-1] if out else '')

print()
print('=== 3. 配置一致性 ===')
pc = json.load(open(os.path.join(ROOT, 'project.config.json'), encoding='utf-8'))
pp = json.load(open(os.path.join(ROOT, 'project.private.config.json'), encoding='utf-8'))
cfg = open(os.path.join(ROOT, 'miniprogram', 'utils', 'config.js'), encoding='utf-8').read()
ENV = 'qqq-d7g05y68803d5476c'
APPID = 'wx871271445ba93093'
check('project.config.json appid', pc.get('appid') == APPID, pc.get('appid'))
check('project.private.config.json appid', pp.get('appid') == APPID, pp.get('appid'))
check('config.js CLOUD_ENV', f"CLOUD_ENV: '{ENV}'" in cfg)
check('config.js ICON_CLOUD_BASE', f"cloud://{ENV}.icons/" in cfg)
check('miniprogramRoot', pc.get('miniprogramRoot') == 'miniprogram/', pc.get('miniprogramRoot'))
check('cloudfunctionRoot', pc.get('cloudfunctionRoot') == 'cloudfunctions/', pc.get('cloudfunctionRoot'))

# cloudbaserc.json
cb = json.load(open(os.path.join(ROOT, 'cloudbaserc.json'), encoding='utf-8'))
check('cloudbaserc envId', cb.get('envId') == ENV, cb.get('envId'))
check('cloudbaserc functions 数量', len(cb.get('functions', [])) == 26, len(cb.get('functions', [])))
check('cloudbaserc MODERATION_MODE=strict',
      all(f.get('envVariables', {}).get('MODERATION_MODE') == 'strict' for f in cb.get('functions', [])))
check('cloudbaserc 无 DEV_OPENID',
      all('DEV_OPENID' not in f.get('envVariables', {}) for f in cb.get('functions', [])))

print()
print('=== 4. 原作者标识残留 ===')
leftover = []
for r, d, fs in os.walk(ROOT):
    d[:] = [x for x in d if x not in ('.git', 'node_modules', 'docs')]
    for f in fs:
        if f.endswith(('.js', '.json', '.wxml', '.wxss')):
            fp = os.path.join(r, f)
            t = open(fp, encoding='utf-8', errors='replace').read()
            if 'wxb354543de577f74b' in t or 'yyq-d6g1dv0kgf893afe8' in t:
                leftover.append(os.path.relpath(fp, ROOT))
check('代码/配置无原作者标识', not leftover, str(leftover[:5]) if leftover else '')

print()
print('=== 5. 安全修复确认 ===')
cf = os.path.join(ROOT, 'cloudfunctions')
mod_strict = 0
mod_lenient = 0
for r, d, fs in os.walk(cf):
    d[:] = [x for x in d if x != 'node_modules']
    for f in fs:
        if f.endswith('.js'):
            t = open(os.path.join(r, f), encoding='utf-8', errors='replace').read()
            mm = re.search(r"MODERATION_MODE\s*\|\|\s*'(\w+)'", t)
            if mm:
                if mm.group(1) == 'strict':
                    mod_strict += 1
                else:
                    mod_lenient += 1
check('MODERATION_MODE 默认 strict', mod_strict == 25 and mod_lenient == 0,
      f'strict={mod_strict} lenient={mod_lenient}')

al = open(os.path.join(cf, 'authLogin', 'index.js'), encoding='utf-8').read()
check('authLogin 有冷启动频控', "rate.hit(openid, 'authLogin'" in al)
check('authLogin 有 bootstrapAllowed 开关', 'function bootstrapAllowed' in al)
check('bootstrapAllowed 被调用', al.count('bootstrapAllowed(openid)') >= 3)

app_js = open(os.path.join(ROOT, 'miniprogram', 'app.js'), encoding='utf-8').read()
check('app.js 有 onNeedPrivacyAuthorization', 'onNeedPrivacyAuthorization' in app_js)
check('app.js 有 grantPrivacyAuthorization', 'grantPrivacyAuthorization' in app_js)

print()
print('=== 6. 协议页完整性 ===')
aj = json.load(open(os.path.join(ROOT, 'miniprogram', 'app.json'), encoding='utf-8'))
check('app.json 注册 agreement 页', 'pages/agreement/agreement' in aj.get('pages', []))
for f in ['agreement.js', 'agreement.wxml', 'agreement.wxss', 'agreement.json']:
    check(f'pages/agreement/{f}', os.path.isfile(os.path.join(ROOT, 'miniprogram', 'pages', 'agreement', f)))
check('utils/agreements.js', os.path.isfile(os.path.join(ROOT, 'miniprogram', 'utils', 'agreements.js')))
ag = open(os.path.join(ROOT, 'miniprogram', 'utils', 'agreements.js'), encoding='utf-8').read()
check('协议含 PRIVACY_VERSION', "PRIVACY_VERSION = 'v1'" in ag)

print()
print('=== 7. 体积 ===')
mp = os.path.join(ROOT, 'miniprogram')
tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(mp) for f in fs)
main = sum(os.path.getsize(os.path.join(r, f))
           for sub in ('pages', 'components', 'utils', 'assets', 'custom-tab-bar')
           for r, _, fs in os.walk(os.path.join(mp, sub)) for f in fs)
check(f'主包 {main//1024}KB ≤ 2048KB', main < 2 * 1024 * 1024)
check(f'整包 {tot//1024}KB ≤ 20480KB', tot < 20 * 1024 * 1024)

print()
print('=' * 50)
print(f'结果：{"全部通过 ✅" if fail == 0 else f"{fail} 项失败 ❌"}')
sys.exit(1 if fail else 0)
