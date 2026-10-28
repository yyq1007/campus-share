"""部署云函数到**原作者的环境**（yyq-d6g1dv0kgf893afe8）。

需要原作者提供「云开发环境 API Key」：
    tcb login --cloudbase-api-key <KEY> -e yyq-d6g1dv0kgf893afe8

用法：
    python tools/deploy-to-author.py --api-key <KEY>
    python tools/deploy-to-author.py --api-key <KEY> --only authLogin
    python tools/deploy-to-author.py --check      # 只用当前登录态试一下

⚠️ api_key 是环境管理员级凭证，持有它等于拥有该环境完整操作权限。
   别写进代码仓库、别截图外传、用完让对方轮换。
"""
import argparse
import json
import os
import subprocess
import sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CF = os.path.join(ROOT, 'cloudfunctions')

AUTHOR_ENV = 'yyq-d6g1dv0kgf893afe8'
RUNTIME = 'Nodejs18.15'
TIMEOUT = 20

ENV_VARS = {
    'MODERATION_MODE': 'strict',
    'WX_ENV_VERSION': 'release',
}


def clean(text):
    return '\n'.join(l for l in (text or '').splitlines()
                     if 'shim' not in l and 'dirname' not in l)


def run(args, t=180):
    p = subprocess.run([NODE, CLI] + args, capture_output=True, text=True,
                       timeout=t, encoding='utf-8', errors='replace')
    return p.returncode, clean((p.stdout or '') + '\n' + (p.stderr or ''))


def login_with_key(api_key):
    """用环境 API Key 登录（需配合 -e 指定环境）"""
    print(f'=== 用环境 API Key 登录 {AUTHOR_ENV} ===')
    rc, out = run(['login', '--cloudbase-api-key', api_key, '-e', AUTHOR_ENV, '--json'], 120)
    ok = rc == 0 and '"error"' not in out and 'error' not in out.lower()[:200]
    print(f'  退出码 {rc}')
    if out:
        print('  ' + out[:500].replace('\n', '\n  '))
    if not ok:
        print('  ❌ 登录失败：key 无效，或缺少该环境的管理员权限')
    return ok


def list_fns(env):
    """列出云上所有函数。
    ⚠️ fn list 默认只返回 20 条（分页），TotalCount 才是真实总数 ——
       少于 20 时会误判成"函数缺失"，要用 fn detail 逐个核实。
    """
    rc, out = run(['fn', 'list', '-e', env, '--json'], 150)
    if rc != 0 or '"error"' in out:
        return None, out
    try:
        d = json.loads(out)
        fns = d['data']['Functions']
        total = d['data'].get('TotalCount', len(fns))
        return fns, f'TotalCount={total}'
    except Exception as e:
        return None, f'parse fail: {e}'


def check_env(env):
    """验证当前登录态能否访问目标环境"""
    fns, info = list_fns(env)
    if fns is None:
        print(f'=== 验证能否访问 {env} ===')
        print('  ❌ 不可访问')
        print('     ' + str(info)[:400])
        return False
    names = sorted(f.get('FunctionName') for f in fns)
    print(f'=== 验证能否访问 {env} ===')
    print(f'  ✅ 可访问，本次返回 {len(fns)} 个（{info}）')
    print('     ' + ', '.join(names))
    if len(fns) < int(str(info).split('=')[-1] or 0):
        print(f'     ⚠️  返回数少于 TotalCount → 分页截断，需 fn detail 逐个核实')
    return True


def gen_config(names, env):
    """写 cloudbaserc.json。返回 (路径, 原内容) —— 原内容用于部署后还原"""
    functions = []
    for n in names:
        functions.append({
            'name': n,
            'timeout': TIMEOUT,
            'runtime': RUNTIME,
            'handler': 'index.main',
            'installDependency': True,
            'envVariables': ENV_VARS,
        })
    cfg = {
        '$schema': 'https://static.cloudbase.net/cli/cloudbaserc.schema.json',
        'envId': env,
        'functionRoot': 'cloudfunctions',
        'functions': functions,
    }
    p = os.path.join(ROOT, 'cloudbaserc.json')
    backup = None
    if os.path.isfile(p):
        backup = open(p, encoding='utf-8').read()
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return p, backup


def restore_config(p, backup):
    """还原 cloudbaserc.json 到部署前状态"""
    if backup is None:
        if os.path.isfile(p):
            os.remove(p)
        print(f'\n已删除临时 {os.path.basename(p)}')
        return
    with open(p, 'w', encoding='utf-8') as f:
        f.write(backup)
    print(f'\n已还原 {os.path.basename(p)}')


def deploy(names, env):
    print(f'=== 部署到 {env} ===\n')
    ok = 0
    for n in names:
        args = [NODE, CLI, 'fn', 'deploy', n,
                '--dir', os.path.join(CF, n),
                '--runtime', RUNTIME,
                '--install-dependency', 'true',
                '--force', '--yes',
                '-e', env, '--json']
        try:
            p = subprocess.run(args, capture_output=True, text=True, timeout=900,
                               encoding='utf-8', errors='replace')
            o = clean((p.stdout or '') + '\n' + (p.stderr or ''))
            good = p.returncode == 0 and '"error"' not in o
            ok += 1 if good else 0
            print(f'  [{"OK" if good else "FAIL"}] {n}')
            if not good:
                print('      ' + o.replace('\n', '\n      ')[:600])
        except subprocess.TimeoutExpired:
            print(f'  [TIMEOUT] {n}')
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api-key')
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--env', default=AUTHOR_ENV,
                    help='目标环境（默认原作者的；--env mine 可用于自测脚本）')
    args = ap.parse_args()

    env = args.env

    if args.api_key:
        print(f'=== 用环境 API Key 登录 {env} ===')
        rc, out = run(['login', '--cloudbase-api-key', args.api_key, '-e', env, '--json'], 120)
        print(f'  退出码 {rc}')
        if out:
            print('  ' + out[:500].replace('\n', '\n  '))
        # ⚠️ tcb login 对无效 key 也可能返回退出码 0（静默失败），
        #    所以不能只看退出码 —— 必须靠后续访问该环境来验证登录是否真生效
        print()
        if not check_env(env):
            print()
            print('  ❌ 用该 key 仍无法访问环境。可能是：')
            print('     · key 无效或已被删除')
            print('     · key 类型选错了（要 api_key，不是 publish_key）')
            print('     · 该 key 属于别的环境')
            print('     · 需要 --token 之类的额外参数')
            return 1
        print()
    elif not check_env(env):
        print()
        print('提示：需要原作者提供「云开发环境 API Key」，或他把你加为小程序开发者成员'
              '（但成员权限只能过开发者工具 GUI，CLI 不行）。')
        return 1

    if args.check:
        return 0

    names = args.only or sorted([d for d in os.listdir(CF)
                                 if os.path.isdir(os.path.join(CF, d)) and d != '_shared'])
    p, backup = gen_config(names, env)
    print(f'\n已更新 {p}（envId={env}）\n')

    try:
        ok = deploy(names, env)
    finally:
        restore_config(p, backup)

    print()
    print(f'=== 部署结果：成功 {ok} / {len(names)} ===')
    return 0 if ok == len(names) else 1


if __name__ == '__main__':
    sys.exit(main())
