"""方案 1 落地脚本：走**微信身份**（开发者工具登录态）部署到原作者环境。

为什么不用 tcb CLI：
  tcb CLI 用的是腾讯云账号 AKID，只能访问自己账号下的环境，作者环境看不到
  （报 env not found in list）。
  开发者工具的 `cli cloud` 走的是**微信小程序的开发者权限**——只要你是该小程序的
  开发者成员，就能直接操作它的云环境，不需要任何 API Key。

前置条件（缺一不可）：
  1. 你已登录开发者工具，且该微信账号是 AppID wxb354543de577f74b 的开发者成员
  2. 开发者工具已开启「服务端口」：设置 → 安全设置 → 服务端口 → 打开
     （开启后 IDE 会写 Default/.ide 文件，CLI 靠它连上）
  3. IDE 处于运行状态

用法：
    python tools/deploy-via-devtools.py            # 全流程
    python tools/deploy-via-devtools.py --check     # 只探测权限
    python tools/deploy-via-devtools.py --skip-assets

流程：
    1. cli cloud env list          → 确认能看到作者环境
    2. cli cloud functions list    → 看当前云上有哪些函数
    3. cli cloud functions deploy  → 部署 26 个云函数
    4. 集合/索引/种子/触发器       → 用 tcb CLI（需该环境可访问；不可访问则跳过并提示）

⚠️ 全程不改仓库里的 appid / envId —— 仓库保持与上游 Zhu 分支逐字一致。
"""
import argparse
import json
import os
import subprocess
import sys

CLI = r'D:\微信web开发者工具\cli.bat'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CF = os.path.join(ROOT, 'cloudfunctions')
AUTHOR_ENV = 'yyq-d6g1dv0kgf893afe8'
APPID = 'wxb354543de577f74b'
PORT = '3799'

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
TCB = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"


def clean(t):
    return '\n'.join(l for l in (t or '').splitlines()
                     if 'shim' not in l and 'dirname' not in l and 'punycode' not in l
                     and 'trace-deprecation' not in l)


def dt(args, t=600):
    """调开发者工具 CLI"""
    p = subprocess.run(['cmd', '/c', CLI] + args, capture_output=True, text=True,
                       timeout=t, encoding='utf-8', errors='replace')
    return p.returncode, clean((p.stdout or '') + '\n' + (p.stderr or ''))


def tcb(args, t=300):
    p = subprocess.run([NODE, TCB] + args, capture_output=True, text=True,
                       timeout=t, encoding='utf-8', errors='replace')
    return p.returncode, clean((p.stdout or '') + '\n' + (p.stderr or ''))


def fn_names():
    return sorted(d for d in os.listdir(CF)
                  if os.path.isdir(os.path.join(CF, d)) and d != '_shared')


def step_env_list():
    print('\n=== 1. 列出该 AppID 下的云环境 ===')
    rc, out = dt(['cloud', 'env', 'list', '--project', ROOT, '--port', PORT])
    print(out[:2000])
    ok = AUTHOR_ENV in out
    print(f'\n  {"✅ 能看到作者环境" if ok else "❌ 看不到 " + AUTHOR_ENV}')
    if not ok:
        print('     可能原因：')
        print('       · 微信账号未登录 / 未扫该小程序码')
        print('       · 你的微信号不是该小程序的开发者成员')
        print('       · IDE 未运行，或服务端口没开')
    return ok


def step_fn_list():
    print('\n=== 2. 云上现有云函数 ===')
    rc, out = dt(['cloud', 'functions', 'list', '--env', AUTHOR_ENV,
                  '--project', ROOT, '--port', PORT])
    print(out[:2500])
    return rc == 0


def step_deploy():
    names = fn_names()
    print(f'\n=== 3. 部署 {len(names)} 个云函数 ===')
    print('   ' + ', '.join(names))
    ok = 0
    failed = []
    for n in names:
        rc, out = dt(['cloud', 'functions', 'deploy',
                      '--env', AUTHOR_ENV,
                      '--names', n,
                      '--project', ROOT,
                      '--remote-npm-install',
                      '--port', PORT], t=900)
        good = rc == 0 and '"error"' not in out and '失败' not in out
        print(f'  [{"OK" if good else "FAIL"}] {n}')
        if not good:
            failed.append(n)
            print('      ' + out.replace('\n', '\n      ')[:500])
        else:
            ok += 1
    print(f'\n  部署结果：成功 {ok} / {len(names)}')
    if failed:
        print('  失败：', failed)
    return ok == len(names)


def step_db():
    """集合/索引/种子/触发器仍走 tcb CLI —— 依赖环境可访问"""
    print('\n=== 4. 集合 / 索引 / 种子 / 触发器（tcb CLI）===')
    rc, out = tcb(['env', 'list', '--json'], 180)
    if AUTHOR_ENV not in out:
        print('  ⚠️  tcb CLI 看不到作者环境（腾讯云账号权限限制），跳过数据库与触发器。')
        print('      这部分需要在「云开发控制台 → 数据库」手动操作，或请作者协助。')
        print('      需要的集合/索引清单见 tools/setup-db.js.py 顶部的注释。')
        return False
    for script, label in [('setup-db.js.py', '集合+索引+种子'), ('setup-triggers.py', '定时触发器')]:
        print(f'\n  --- {label} ---')
        p = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', script)],
                           cwd=ROOT, capture_output=True, text=True,
                           timeout=1800, encoding='utf-8', errors='replace')
        print(clean((p.stdout or '') + '\n' + (p.stderr or ''))[-2500:])
    return True


def step_assets():
    print('\n=== 5. 上传云存储素材（可选）===')
    p = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'upload-assets.py')],
                       cwd=ROOT, capture_output=True, text=True,
                       timeout=1800, encoding='utf-8', errors='replace')
    print(clean((p.stdout or '') + '\n' + (p.stderr or ''))[-1500:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--skip-assets', action='store_true')
    args = ap.parse_args()

    print(f'目标环境: {AUTHOR_ENV}（原作者的）')
    print(f'AppID   : {APPID}（不修改仓库配置）')
    print(f'仓库    : {ROOT}')

    if not step_env_list():
        return 1
    if not step_fn_list():
        print('\n❌ 函数列表都拿不到，停止')
        return 1
    if args.check:
        print('\n✅ 权限验证通过，可以去掉 --check 做完整部署')
        return 0

    if not step_deploy():
        print('\n⚠️  部分函数部署失败')
        return 1
    step_db()
    if not args.skip_assets:
        step_assets()

    print('\n' + '=' * 60)
    print('✅ 部署流程执行完毕')
    print('=' * 60)
    print('接下来在开发者工具里：')
    print(f'  导入项目目录：{ROOT}')
    print(f'  AppID：{APPID}（保持不变）')
    print('  点「编译」即可看到模拟器')
    return 0


if __name__ == '__main__':
    sys.exit(main())
