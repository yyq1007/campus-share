"""方案 1：把 Zhu 分支完整部署到**原作者的云环境** yyq-d6g1dv0kgf893afe8。

前置条件（缺一不可）：
  A. 原作者提供「云开发环境 API Key」——环境管理员级凭证
     获取路径：微信开发者工具 → 云开发 → 设置 → 全局设置 → 高级设置 → 环境密钥
     注意要 **api_key**，不是 publish_key
  B. 你的微信账号已被加为该小程序的「开发者」成员
     （否则开发者工具打不开项目、也拿不到小程序码）

用法：
    python tools/deploy-full-to-author.py --api-key <KEY>              # 全流程
    python tools/deploy-full-to-author.py --api-key <KEY> --skip-assets
    python tools/deploy-full-to-author.py --check --api-key <KEY>     # 只验证权限

流程：
    1. 用 API Key 登录并验证能访问作者环境
    2. 建集合 + 索引 + 种子数据（tools/setup-db.js.py）
    3. 部署 26 个云函数（tools/deploy-to-author.py）
    4. 建 3 个定时触发器（tools/setup-triggers.py）
    5. 上传云存储素材（tools/upload-assets.py，可跳过）

⚠️ 全程不改仓库里的 appid / envId —— 仓库保持与上游 Zhu 分支逐字一致。
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
PY = sys.executable

STEPS = [
    ('建集合 + 索引 + 种子数据', 'setup-db.js.py', []),
    ('部署 26 个云函数', 'deploy-to-author.py', ['--api-key', '{KEY}']),
    ('建定时触发器', 'setup-triggers.py', []),
    ('上传云存储素材', 'upload-assets.py', []),
]


def run(script, args, label):
    print(f'\n{"=" * 60}')
    print(f'>>> {label}（{script}）')
    print('=' * 60)
    cmd = [PY, os.path.join(TOOLS, script)] + args
    p = subprocess.run(cmd, cwd=ROOT)
    return p.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api-key', required=True)
    ap.add_argument('--check', action='store_true', help='只验证权限，不部署')
    ap.add_argument('--skip-assets', action='store_true', help='跳过云存储素材上传')
    args = ap.parse_args()

    if not args.api_key:
        print('缺少 --api-key')
        return 2

    print(f'目标环境: yyq-d6g1dv0kgf893afe8（原作者的）')
    print(f'仓库目录: {ROOT}')
    print(f'当前分支: {subprocess.run(["git", "-C", ROOT, "branch", "--show-current"], capture_output=True, text=True).stdout.strip()}')

    # 1. 验证权限
    rc = run('deploy-to-author.py', ['--api-key', args.api_key, '--check'], '验证 API Key 权限')
    if rc != 0:
        print('\n❌ 权限验证失败，已中止。请确认：')
        print('   · key 类型是 api_key（不是 publish_key）')
        print('   · key 属于环境 yyq-d6g1dv0kgf893afe8')
        print('   · key 未被作者删除/轮换')
        return rc
    if args.check:
        print('\n✅ 权限验证通过，可执行完整部署（去掉 --check）')
        return 0

    # 2~5 依次执行
    for label, script, extra in STEPS:
        if args.skip_assets and script == 'upload-assets.py':
            print(f'\n>>> 跳过：{label}')
            continue
        a = [x.replace('{KEY}', args.api_key) for x in extra]
        rc = run(script, a, label)
        if rc != 0:
            print(f'\n❌ 步骤失败：{label}（返回码 {rc}）')
            return rc

    print('\n' + '=' * 60)
    print('✅ 全流程完成')
    print('=' * 60)
    print('下一步（需要你在桌面操作）：')
    print('  1. 打开微信开发者工具 → 导入项目')
    print(f'     目录: {ROOT}')
    print('     AppID: wxb354543de577f74b（作者的，不要改）')
    print('  2. 编译 → 确认模拟器正常')
    print('  3. 预览到手机（需先在 mp 后台把你加为开发者）')
    print('  4. 邀请码：数据库 invites 集合里的 seed-gxnu2026 / GXNU2026')
    return 0


if __name__ == '__main__':
    sys.exit(main())
