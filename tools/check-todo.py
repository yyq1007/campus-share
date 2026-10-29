"""检查「还缺什么」——分两类：代码侧（我能改）和后台侧（你得在 mp 官网点）。

用法：
    python tools/check-todo.py
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(ROOT, 'miniprogram')
NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'yyq-d6g1dv0kgf893afe8'
APPID = 'wxb354543de577f74b'

code_ok, code_bad = [], []
backend = []


def check(title, ok, detail=''):
    (code_ok if ok else code_bad).append(title)
    print(f'  [{"OK " if ok else "缺 "}] {title}' + (f'   {detail}' if detail else ''))


def run(args, t=180):
    p = subprocess.run([NODE, CLI] + args, capture_output=True, text=True,
                       timeout=t, encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return '\n'.join(l for l in o.splitlines()
                     if 'shim' not in l and 'dirname' not in l)


print('=' * 62)
print('  A. 代码 / 云端  —— 这些我已经全做完，你不用管')
print('=' * 62)

# 1. 配置
aj = json.load(open(os.path.join(MP, 'app.json'), encoding='utf-8'))
pc = json.load(open(os.path.join(ROOT, 'project.config.json'), encoding='utf-8'))
cb = json.load(open(os.path.join(ROOT, 'cloudbaserc.json'), encoding='utf-8'))
cfg = open(os.path.join(MP, 'utils', 'config.js'), encoding='utf-8').read()

check('AppID 已指向你自己的小程序', pc.get('appid') == APPID, pc.get('appid'))
check('云环境已指向你的环境', cb.get('envId') == ENV, cb.get('envId'))
check('前端 CLOUD_ENV 一致', f"CLOUD_ENV: '{ENV}'" in cfg)

# ⚠️ requiredPrivateInfos 是「地理位置接口」专用字段，官方白名单只有 8 个：
#   getFuzzyLocation / getLocation / onLocationChange / startLocationUpdate /
#   startLocationUpdateBackground / chooseLocation / choosePoi / chooseAddress
#   填错会导致模拟器直接启动失败（"requiredPrivateInfos[0] 字段值为 ..."）。
#   chooseMedia / saveImageToPhotosAlbum 属于「用户主动触发」类，走
#   onNeedPrivacyAuthorization + 隐私协议页，不需要在这里声明。
GEO_ONLY = {'getFuzzyLocation', 'getLocation', 'onLocationChange',
            'startLocationUpdate', 'startLocationUpdateBackground',
            'chooseLocation', 'choosePoi', 'chooseAddress'}
rpi = aj.get('requiredPrivateInfos', [])
bad_rpi = [x for x in rpi if x not in GEO_ONLY]
check('requiredPrivateInfos 合法（只含地理位置接口）', not bad_rpi,
      f'非法值: {bad_rpi}' if bad_rpi else (str(rpi) if rpi else '未声明（本项目不需要）'))

# 2. 协议页
for f in ['agreement.js', 'agreement.wxml', 'agreement.wxss', 'agreement.json']:
    check(f'协议页 {f}',
          os.path.isfile(os.path.join(MP, 'pages', 'agreement', f)))
check('协议页已注册到 app.json',
      'pages/agreement/agreement' in aj.get('pages', []))
app_js = open(os.path.join(MP, 'app.js'), encoding='utf-8').read()
check('隐私授权钩子已实现', 'onNeedPrivacyAuthorization' in app_js)

# 3. 云函数状态
fns = ['adminQueue', 'adminReview', 'aiEmbed', 'aiStructure', 'askQuery',
       'authBindInvite', 'authDelete', 'authLogin', 'clientLog', 'commentCreate',
       'commentList', 'interactionToggle', 'meList', 'meMessageRead', 'meOverview',
       'meUpdateProfile', 'mediaCheck', 'postCreate', 'postDelete', 'postDetail',
       'postList', 'reportCreate', 'taskCleanup', 'taskHotScore', 'taskVectorize',
       'wxacodeGen']
active = 0
for n in fns:
    o = run(['fn', 'detail', n, '-e', ENV, '--json'], 120)
    try:
        d = json.loads(o)
        f = d.get('data', d)
        if f.get('Status') == 'Active':
            active += 1
    except Exception:
        pass
check(f'26 个云函数全部在线', active == 26, f'{active}/26')

# 4. 数据库
o = run(['db', 'nosql', 'execute', '--command',
         json.dumps([{'TableName': '', 'CommandType': 'COMMAND',
                      'Command': json.dumps({'listCollections': 1, 'filter': {}})}]),
         '-e', ENV, '--json'], 150)
cols = []


def walk(n):
    if isinstance(n, dict):
        if 'name' in n and 'type' in n:
            cols.append(n['name'])
            return
        for v in n.values():
            walk(v)
    elif isinstance(n, list):
        for v in n:
            walk(v)


try:
    walk(json.loads(o).get('data', {}))
except Exception:
    pass
need_cols = ['users', 'posts', 'comments', 'interactions', 'reports', 'reviewQueue',
              'messages', 'configs', 'qaLogs', 'vectors', 'invites', 'inviteCodes',
              'mediaAssets', 'auditLogs', 'rateLimits', 'sensitiveWords', 'qrcodes',
              'idempotency']
missing = sorted(set(need_cols) - set(cols))
check('18 个数据库集合已建', not missing, f'缺 {missing}' if missing else f'{len(cols)} 个')

# 5. 演示数据
o = run(['db', 'nosql', 'execute', '--command',
         json.dumps([{'TableName': 'posts', 'CommandType': 'QUERY',
                      'Command': json.dumps({'find': 'posts', 'filter': {}, 'limit': 100})}]),
         '-e', ENV, '--json'], 150)
try:
    n = len(json.loads(o)['data']['results'][0])
except Exception:
    n = 0
check('演示数据已灌入（打开就有内容）', n >= 4, f'{n} 条帖子')

# 6. 静态检查
p = subprocess.run([NODE, os.path.join(ROOT, 'tools', 'static-check.js')], cwd=ROOT,
                   capture_output=True, text=True, timeout=240,
                   encoding='utf-8', errors='replace')
m = re.search(r'共\s*(\d+)\s*处问题', p.stdout or '')
check('代码静态检查通过', bool(m) and m.group(1) == '0',
      (p.stdout or '').strip().splitlines()[-1] if p.stdout else '')

print()
print('=' * 62)
print('  B. 微信后台  —— 这些只能你在 mp.weixin.qq.com 点，我改不了')
print('=' * 62)
backend = [
    ('① 导入项目到开发者工具',
     'D:\\微信web开发者工具\\cli.bat open --project "%s"' % ROOT,
     '装好工具后跑这条命令，或手动「导入项目」选 campus-share 目录'),
    ('② 第一次登录（占住管理员）',
     '已完成 —— 你已登录，role=admin，邀请码也已绑定',
     '✅ 这一步不用做了'),
    ('③ 用户隐私保护指引',
     'mp.weixin.qq.com → 开发管理 → 用户隐私保护指引',
     '声明用到的：chooseMedia（选图发帖）、saveImageToPhotosAlbum（保存图片）'),
    ('④ 开通「内容安全」能力',
     'mp.weixin.qq.com → 开发管理 → 接口设置',
     '不开通不会崩，但所有内容都要人工审'),
    ('⑤ 提交审核 / 发布',
     'mp.weixin.qq.com → 版本管理 → 开发版本 → 提交审核',
     '代码没问题，主要是①到④做完就能提'),
]
for t, how, why in backend:
    print(f'\n  {t}')
    print(f'     怎么做: {how}')
    print(f'     为什么: {why}')

print()
print('=' * 62)
print(f'  总结：代码侧 {len(code_ok)} 项全通过' if not code_bad else
      f'  总结：代码侧还有 {len(code_bad)} 项缺：{code_bad}')
print('        后台侧 5 项要你自己点（上面 B 区）')
print('=' * 62)
sys.exit(1 if code_bad else 0)
