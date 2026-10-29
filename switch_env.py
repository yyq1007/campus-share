"""一键切换 campus-share 的 AppID 与云环境。

用法：
    python switch_env.py --profile mine      # 切到小明自己的（本地部署用）
    python switch_env.py --profile author    # 切回原作者（上传到他的环境用）
    python switch_env.py --profile mine --dry-run   # 只看要改什么，不写入

两个 profile 的值都写死在这里，切换后前端与云函数配置同时生效。
云函数本身不硬编码 envId（全部用 cloud.DYNAMIC_CURRENT_ENV），所以切环境时云函数代码不用动。
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if os.path.basename(ROOT) != 'campus-share':
    ROOT = os.path.join(ROOT, 'campus-share')

PROFILES = {
    'mine': {
        'label': '小明自己的',
        'appid': 'wx871271445ba93093',
        'env': 'qqq-d7g05y68803d5476c',
    },
    'author': {
        'label': '原作者的',
        'appid': 'wxb354543de577f74b',
        'env': 'yyq-d6g1dv0kgf893afe8',
    },
}

FILES = [
    ('project.config.json', 'appid'),
    ('project.private.config.json', 'appid'),
]


def read(p):
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8') as f:
        return f.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', required=True, choices=list(PROFILES))
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    prof = PROFILES[args.profile]
    appid, env = prof['appid'], prof['env']
    changes = []

    # 1. 两个 json 里的 appid
    for rel, key in FILES:
        p = os.path.join(ROOT, rel)
        txt = read(p)
        if txt is None:
            changes.append((rel, '新增文件', appid))
            if not args.dry_run:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, 'w', encoding='utf-8') as f:
                    json.dump({'appid': appid, 'projectname': 'campus-share'}, f,
                              ensure_ascii=False, indent=2)
                    f.write('\n')
            continue
        try:
            data = json.loads(txt)
        except json.JSONDecodeError:
            print(f'  ! {rel} 不是合法 JSON，跳过')
            continue
        old = data.get(key)
        if old == appid:
            print(f'  = {rel}: appid 已是 {appid}，无需改')
            continue
        changes.append((rel, f'appid: {old} -> {appid}', appid))
        if not args.dry_run:
            data[key] = appid
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write('\n')

    # 2. config.js 的 CLOUD_ENV + ICON_CLOUD_BASE
    cfgp = os.path.join(ROOT, 'miniprogram', 'utils', 'config.js')
    txt = read(cfgp)
    if txt is None:
        print('  ! 找不到 miniprogram/utils/config.js')
        return 1
    new = txt
    new = re.sub(r"(CLOUD_ENV:\s*')[^']*(')", r"\g<1>%s\g<2>" % env, new)
    new = re.sub(r"(ICON_CLOUD_BASE:\s*')[^']*(')",
                 r"\g<1>cloud://%s.icons/\g<2>" % env, new)
    if new != txt:
        changes.append(('miniprogram/utils/config.js', f'CLOUD_ENV -> {env}', env))
        if not args.dry_run:
            with open(cfgp, 'w', encoding='utf-8') as f:
                f.write(new)

    print()
    print(f'目标 profile: {args.profile}（{prof["label"]}）')
    print(f'  AppID: {appid}')
    print(f'  envId: {env}')
    print()
    if not changes:
        print('无需改动。')
    else:
        for rel, desc, _ in changes:
            print(f'  [{"预览" if args.dry_run else "已改"}] {rel}  {desc}')

    if args.dry_run:
        print('\n（dry-run，未写入）')
    else:
        print('\n写入完成。')

    print()
    print('--- 后续步骤 ---')
    if args.profile == 'mine':
        print('  1. 部署云函数：见 部署手册.md 第 3 节')
        print('  2. 建集合与索引：见 建环境清单.md')
        print('  3. 上传云存储 assets/')
        print('  4. 开发者工具导入项目（AppID 保持 wx871271445ba93093）')
    else:
        print('  1. 需 yyq1007 把你加为该小程序的「开发者」成员')
        print('  2. 开发者工具导入项目，AppID 保持 wxb354543de577f74b')
        print('  3. 右键云函数目录 → 上传并部署：云端安装依赖')
        print('  4. 公众平台配置合法域名与隐私指引')
    return 0


if __name__ == '__main__':
    sys.exit(main())
