"""静态校验隐私门禁的三种行为。

不跑小程序（起不来），用源码分析 + 语法校验的方式逐条核对：
  1. 点「同意」→ 落缓存 + 放行 → 进 app
  2. 点「暂不」→ 关闭小程序（不退出流程走 agree）
  3. 未同意 → 拦得住，进不去内容
"""
import os
import re
import subprocess
import sys

REPO = r'C:\Users\Admin（无密码）\WorkBuddy\2026-10-29-13-50-45\campus-share'
MP = os.path.join(REPO, 'miniprogram')


def read(p):
    return open(os.path.join(MP, p.replace('/', os.sep)), encoding='utf-8', errors='replace').read()


app = read('app.js')
gate = read('components/privacy-gate/privacy-gate.js')
agree = read('pages/agreement/agreement.js')
auth = read('utils/auth.js')
privacy = read('utils/privacy.js')
gate_wxml = read('components/privacy-gate/privacy-gate.wxml')
gate_wxss = read('components/privacy-gate/privacy-gate.wxss')

results = []


def check(name, ok, detail=''):
    results.append((ok, name, detail))
    print(f'  [{"PASS" if ok else "FAIL"}] {name}' + (f'  —— {detail}' if detail else ''))


print('=' * 68)
print('行为 1：点「同意」→ 进 app')
print('=' * 68)

check('组件 onAgree 调用 markAgreed() 落缓存',
      'markAgreed()' in gate)
check('组件 onAgree 调用 grantPrivacyAuthorization() 放行隐私接口',
      'grantPrivacyAuthorization' in gate)
check('组件 onAgree 关闭遮罩 visible=false',
      re.search(r'onAgree\s*\(\)\s*\{.*?visible:\s*false', gate, re.S) is not None)
check('app.grantPrivacyAuthorization 落缓存并 resolve agree',
      re.search(r'grantPrivacyAuthorization\s*\(\)\s*\{.*?markAgreed\(\).*?resolve\(\{\s*buttonId:\s*[\'"]agree', app, re.S) is not None)
check('协议页 onAgree 同样落缓存（首启场景兜底）',
      'markAgreed()' in agree)
check('同意标记与版本号绑定（版本升级需重新同意）',
      "AGREE_KEY = 'privacy_agreed_version'" in privacy and 'PRIVACY_VERSION' in privacy)

print()
print('=' * 68)
print('行为 2：点「拒绝」→ 关闭小程序')
print('=' * 68)

check('组件 onDismiss 调用 __privacyReject()',
      re.search(r'onDismiss\s*\(\)\s*\{.*?__privacyReject', gate, re.S) is not None)
check('app.__privacyReject 调用 wx.exitMiniProgram()',
      re.search(r'__privacyReject\s*\(\)\s*\{.*?wx\.exitMiniProgram', app, re.S) is not None)
check('__privacyReject 不调 resolve({event:disagree})（避免微信自行误关）',
      re.search(r'__privacyReject\s*\(\)\s*\{[^}]*event:\s*[\'"]disagree', app, re.S) is None)
check('app 层 showModal 的「暂不」分支也走 __privacyReject（弹窗兜底）',
      re.search(r'cancelText:\s*[\'"]暂不[\'"].*?__privacyReject', app, re.S) is not None)
check('暂不路径不写同意标记（下次冷启动仍拦截）',
      'markAgreed' not in re.search(r'onDismiss\s*\(\)\s*\{(.*?)\n  \}\n\}', gate, re.S).group(1)
      if re.search(r'onDismiss\s*\(\)\s*\{(.*?)\n  \}\n\}', gate, re.S) else False)
check('拒绝按钮文案为「拒绝」且无括号后缀',
      '拒绝' in gate_wxml and '（将退出小程序）' not in gate_wxml)
check('拒绝按钮用独立可点样式（pg-reject，不复用 pg-note 小字）',
      'pg-reject' in gate_wxml and 'pg-reject' in gate_wxss)
check('开发者工具里点拒绝有可见反馈（complete 里 toast）',
      'complete' in app and '需同意协议后才能使用' in app)

print()
print('=' * 68)
print('行为 3：未同意 → 进不去内容')
print('=' * 68)

check('组件遮罩为不透明底色（内容完全不可见）',
      'var(--bg-page)' in gate_wxss and 'var(--scrim)' not in gate_wxss)
check('遮罩 fixed 全屏 + 高 z-index',
      'position: fixed' in gate_wxss and 'z-index: 900' in gate_wxss)
check('guard() 拦截未同意的请求（不发给后端）',
      re.search(r'async function guard\s*\(\)\s*\{.*?if\s*\(!hasAgreed\(\)\)', auth, re.S) is not None)
check('guard 拦截时不调 ensureLogin（不发云函数请求）',
      re.search(r'if\s*\(!hasAgreed\(\)\)\s*\{.*?return null', auth, re.S) is not None)
check('组件 attached 时按未同意状态显示遮罩',
      re.search(r'attached\s*\(\)\s*\{.*?visible:\s*!hasAgreed\(\)', gate, re.S) is not None)
check('组件接管标记写入 app，避免双重弹窗',
      'privacyGateActive = true' in gate and 'privacyGateActive' in app)
check('app 层在组件接管时不重复弹 modal',
      'if (this.privacyGateActive) return' in app)

# 页面覆盖
import json
aj = json.load(open(os.path.join(MP, 'app.json'), encoding='utf-8'))
pages = list(aj.get('pages', []))
for s in aj.get('subpackages', []):
    for p in sorted(os.listdir(os.path.join(MP, s['root']))):
        if os.path.isdir(os.path.join(MP, s['root'], p)):
            pages.append(f"{s['root']}/{p}")

guard_pages, gate_pages = [], []
for p in pages:
    js = os.path.join(MP, p.replace('/', os.sep) + '.js')
    wm = os.path.join(MP, p.replace('/', os.sep) + '.wxml')
    if os.path.exists(js) and 'guard(' in open(js, encoding='utf-8', errors='replace').read():
        guard_pages.append(p)
    if os.path.exists(wm) and 'privacy-gate' in open(wm, encoding='utf-8', errors='replace').read():
        gate_pages.append(p)

print(f'\n  页面总数 {len(pages)}：')
print(f'    · 走 guard() 拦截 : {len(guard_pages)} 个')
print(f'    · 挂 privacy-gate  : {len(gate_pages)} 个 → {gate_pages}')
no_guard = [p for p in pages if p not in guard_pages]
print(f'    · 不走 guard 的页面: {no_guard}')
print('      （about/agreement 是协议展示页本身，invite 已挂组件，admin 是分包后台）')

print()
print('=' * 68)
print('语法校验（node --check）')
print('=' * 68)
NODE = r'C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
for f in ['app.js', 'utils/privacy.js', 'utils/auth.js',
          'components/privacy-gate/privacy-gate.js', 'pages/agreement/agreement.js']:
    r = subprocess.run([NODE, '--check', os.path.join(MP, f.replace('/', os.sep))],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    check(f'{f} 语法', r.returncode == 0, (r.stderr or '').strip()[:150])

print()
print('=' * 68)
failed = [r for r in results if not r[0]]
print(f'合计：{len(results) - len(failed)} 通过 / {len(failed)} 失败')
if failed:
    for _, n, d in failed:
        print(f'  ❌ {n}  {d}')
sys.exit(1 if failed else 0)
