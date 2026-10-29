"""云函数自测：临时注入 DEV_OPENID，invoke 看真实返回，再立刻清理。

为什么需要：小程序起不来 / 开发者工具连不上时，只能从云端验证云函数逻辑。
auth.js 支持 process.env.DEV_OPENID（见 cloudfunctions/_shared/lib/auth.js），
注入后 `tcb fn invoke` 能走通鉴权跑真实逻辑。

⚠️ DEV_OPENID 是环境管理员级凭证 —— 任何拿到它的人都能冒充该用户。
   所以注入后**必须**重新部署不带它的正式版本，且要复核确认已清除。

用法：
    python tools/selftest-cloudfn.py postList --params '{"sort":"hot"}'
    python tools/selftest-cloudfn.py interactionToggle --params '{"targetId":"xxx","type":"like"}'

流程：
    1. 建临时目录 → 拷目标函数源码 → 写 cloudbaserc.json（envVariables 带 DEV_OPENID）
    2. tcb fn deploy <fn> --cwd 临时目录
    3. tcb fn invoke <fn> --params '<json>' → 打印 RetMsg
    4. 用仓库的 tools/deploy-fns.py 重新部署正式版本（它会显式传 runtime + envVariables）
    5. 复核 DEV_OPENID 已清除
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

NODE = r'C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
CLI = r'C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(REPO, '_selftest_tmp')
ENV = 'qqq-d7g05y68803d5476c'

# 与其它云函数一致的运行时（别用 Nodejs16.13，仓库统一 Nodejs18.15）
RUNTIME = 'Nodejs18.15'

# 小明的 openid（auth.js 的 DEV_OPENID 用 openid，不是 uid）
# uid = f1812de06ae3438100a5a1b942a6f13f
DEV_OPENID = 'olH7pxaJyr0uilb7DxiwcFs5mHPI'


def cli(args, cwd=None, timeout=900):
    r = subprocess.run([NODE, CLI] + args, cwd=cwd, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    t = (r.stdout or '') + '\n' + (r.stderr or '')
    return r.returncode, '\n'.join(l for l in t.splitlines()
                                   if 'shim' not in l and 'dirname' not in l)


def deploy_with_dev(fn):
    shutil.rmtree(TMP, ignore_errors=True)
    os.makedirs(os.path.join(TMP, 'cloudfunctions'), exist_ok=True)
    shutil.copytree(os.path.join(REPO, 'cloudfunctions', fn),
                    os.path.join(TMP, 'cloudfunctions', fn), dirs_exist_ok=True)
    cfg = {
        'envId': ENV,
        'functionRoot': './cloudfunctions',
        'functions': [{
            'name': fn,
            'timeout': 20,
            'runtime': RUNTIME,
            'handler': 'index.main',
            'installDependency': True,
            'memorySize': 256,
            'envVariables': {'DEV_OPENID': DEV_OPENID},
        }],
    }
    with open(os.path.join(TMP, 'cloudbaserc.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f'=== 部署带 DEV_OPENID 的 {fn} ===')
    rc, t = cli(['fn', 'deploy', fn, '-e', ENV, '--force', '--yes', '--cwd', TMP],
                cwd=TMP)
    print(t[-600:])
    return rc == 0


def invoke(fn, params):
    print()
    print(f'=== invoke {fn} ===')
    rc, t = cli(['fn', 'invoke', fn, '-e', ENV, '--params', params], timeout=600)
    # invoke 输出前面有 CLI 自己的日志，RetMsg 在 JSON 里 —— 直接在文本里找
    marker = '"RetMsg"'
    i = t.find(marker)
    if i >= 0:
        # RetMsg 的值是被字符串化的 JSON
        j = t.find('{', i)
        depth = 0
        end = j
        in_str = False
        esc = False
        for k in range(j, len(t)):
            ch = t[k]
            if in_str:
                if esc:
                    esc = False
                elif ch == '\\':
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = k + 1
                    break
        raw = t[j:end]
        try:
            ret = json.loads(raw)
        except Exception:
            ret = raw
        print(json.dumps(ret, ensure_ascii=False, indent=2)[:4000])
        return ret
    print(t[-2000:])
    return None


def deploy_clean(fn):
    """清理：重新部署不带 DEV_OPENID 的正式版本。

    ⚠️ 必须用仓库的 tools/deploy-fns.py —— 它会显式传 runtime + envVariables。
    直接 `tcb fn deploy <fn>`（不带 --cwd）会因为仓库 cloudbaserc.json 里
    没声明该函数而报 "config not found in config file"，然后**沿用旧的环境变量**
    → DEV_OPENID 清不掉！这是能冒充管理员的凭证。
    """
    print()
    print('=== 清理：重新部署不带 DEV_OPENID 的正式版本 ===')
    r = subprocess.run([sys.executable, os.path.join(REPO, 'tools', 'deploy-fns.py'),
                        '--deploy', '--only', fn],
                       cwd=REPO, capture_output=True, text=True, encoding='utf-8',
                       errors='replace', timeout=900)
    print('rc', r.returncode)
    print((r.stdout or '')[-500:])

    rc, t = cli(['fn', 'detail', fn, '-e', ENV, '--json'], timeout=240)
    try:
        i = t.find('{')
        info = json.loads(t[i:]).get('data', {})
        vars_ = (info.get('Environment') or {}).get('Variables') or []
        print('  runtime:', info.get('Runtime'))
        print('  envVars:', [v.get('Key') for v in vars_])
        if any(v.get('Key') == 'DEV_OPENID' for v in vars_):
            print('  ❌ DEV_OPENID 仍残留！必须手动清理')
            return False
        print('  ✅ DEV_OPENID 已清除')
    except Exception as e:
        print('  复核失败:', repr(e)[:100])
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('fn', help='云函数名')
    ap.add_argument('--params', default='{}', help='invoke 参数 JSON')
    ap.add_argument('--keep', action='store_true', help='保留临时目录（调试用）')
    a = ap.parse_args()

    ok = False
    try:
        if not deploy_with_dev(a.fn):
            print('部署失败')
            return 1
        invoke(a.fn, a.params)
        ok = True
    finally:
        deploy_clean(a.fn)
        if not a.keep:
            shutil.rmtree(TMP, ignore_errors=True)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
