"""上传小程序图标到云存储（config.js 注释里提到的 tools/upload-assets）。

当前 icons.js 的图标一律走包内路径（localIcon），云存储副本仅为兼容保留。
所以这个脚本不是运行必需，但传上去能让 ICON_CLOUD_BASE 指向真实存在的路径，
避免以后有人误用 cloudIcon() 时拿到 404。

用法：
    python tools/upload-assets.py              # 上传到 icons/
    python tools/upload-assets.py --prefix assets/   # 上传到 assets/icons/（原注释所述）
"""
import argparse
import os
import subprocess
import sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = 'yyq-d6g1dv0kgf893afe8'
ICONS = os.path.join(ROOT, 'miniprogram', 'assets', 'icons')


def run(args, t=180):
    p = subprocess.run([NODE, CLI] + args, capture_output=True, text=True,
                       timeout=t, encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return p.returncode, '\n'.join(l for l in o.splitlines()
                                   if 'shim' not in l and 'dirname' not in l)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prefix', default='icons',
                    help='云存储路径前缀，默认 icons/；用 assets 则传 assets/icons/')
    ap.add_argument('--env', default=ENV)
    args = ap.parse_args()

    if not os.path.isdir(ICONS):
        print(f'❌ 找不到图标目录 {ICONS}')
        return 1

    files = sorted(f for f in os.listdir(ICONS) if f.endswith('.png'))
    print(f'=== 上传 {len(files)} 个 PNG 到 {args.prefix}/ ===\n')

    ok = 0
    failed = []
    for f in files:
        src = os.path.join(ICONS, f)
        dst = f'{args.prefix}/{f}'
        rc, out = run(['storage', 'upload', src, dst, '-e', args.env, '--json'], 120)
        good = rc == 0 and '"error"' not in out
        if good:
            ok += 1
            print(f'  [OK] {dst}')
        else:
            failed.append(dst)
            print(f'  [FAIL] {dst}: {out[:200]}')

    print()
    print(f'=== 上传完成：成功 {ok} / {len(files)} ===')
    if failed:
        print('  失败:', failed[:10])

    print()
    print('配置对应写法：')
    print(f"  ICON_CLOUD_BASE: 'cloud://{args.env}.{args.prefix}/',")
    return 0 if ok == len(files) else 1


if __name__ == '__main__':
    sys.exit(main())
