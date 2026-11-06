"""生成 cloudbaserc.json（驱动 tcb fn deploy --all）并可选直接部署。

用法：
    python tools/deploy-fns.py --gen-only          # 只生成配置
    python tools/deploy-fns.py --deploy            # 生成配置并批量部署
    python tools/deploy-fns.py --deploy --only authLogin postList
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
ENV = 'qqq-d7g05y68803d5476c'

# 运行时：与作者线上保持一致（Nodejs18.15），支持云端安装依赖
RUNTIME = 'Nodejs18.15'
TIMEOUT = 20

# 环境变量：
#   MODERATION_MODE=strict  内容安全接口不可用时转人工复核，不放行
#   DEV_OPENID  必须留空 —— 填了之后知道这个值的人能冒充管理员
#   WX_ENV_VERSION=release  与作者线上环境一致
ENV_VARS = {
    'MODERATION_MODE': 'strict',
    'WX_ENV_VERSION': 'release',
}

DESCRIPTIONS = {
    'adminQueue': '校园分享 · 管理队列（审核台拉取待处理项）',
    'adminReview': '校园分享 · 审核裁决（通过/驳回/下线）',
    'aiEmbed': '校园分享 · AI 向量化（内容入向量库）',
    'aiStructure': '校园分享 · AI 结构化（内容字段抽取）',
    'askQuery': '校园分享 · AI 问答检索',
    'authBindInvite': '校园分享 · 邀请码绑定',
    'authDelete': '校园分享 · 账号注销',
    'authLogin': '校园分享 · 登录/建号（openid 无感登录）',
    'clientLog': '校园分享 · 客户端异常上报',
    'commentCreate': '校园分享 · 评论发布',
    'commentList': '校园分享 · 评论列表',
    'interactionToggle': '校园分享 · 点赞/收藏切换',
    'meList': '校园分享 · 我的列表（帖子/收藏）',
    'meMessageRead': '校园分享 · 消息已读',
    'meOverview': '校园分享 · 我的概览（统计/未读）',
    'meUpdateProfile': '校园分享 · 资料更新',
    'mediaCheck': '校园分享 · 内容安全检测（文本/图片）',
    'postCreate': '校园分享 · 发帖',
    'postDelete': '校园分享 · 删帖',
    'postDetail': '校园分享 · 帖子详情',
    'postList': '校园分享 · 帖子列表（首页/板块/搜索）',
    'reportCreate': '校园分享 · 举报',
    'taskCleanup': '校园分享 · 定时任务（过期扫描/临时文件清理）',
    'taskHotScore': '校园分享 · 定时任务（热度分数刷新）',
    'taskVectorize': '校园分享 · 定时任务（向量重建）',
    'wxacodeGen': '校园分享 · 小程序码生成',
}


def fn_names():
    return sorted([d for d in os.listdir(CF)
                   if os.path.isdir(os.path.join(CF, d)) and d != '_shared'])


def gen_config(only=None):
    names = only or fn_names()
    functions = []
    for n in names:
        entry = {
            'name': n,
            'timeout': TIMEOUT,
            'runtime': RUNTIME,
            'handler': 'index.main',
            'installDependency': True,
            'envVariables': ENV_VARS,
        }
        if n in DESCRIPTIONS:
            entry['description'] = DESCRIPTIONS[n]
        functions.append(entry)
    # 官方格式：functions 是顶层数组，functionRoot 指向云函数目录
    cfg = {
        '$schema': 'https://static.cloudbase.net/cli/cloudbaserc.schema.json',
        'envId': ENV,
        'functionRoot': 'cloudfunctions',
        'functions': functions,
    }
    p = os.path.join(ROOT, 'cloudbaserc.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return p, names


def deploy(names, install_dep='true'):
    """逐个部署（比 --all 更可控，能看到每个函数的结果）"""
    results = []
    for n in names:
        args = [NODE, CLI, 'fn', 'deploy', n,
                '--dir', os.path.join(CF, n),
                '--runtime', RUNTIME,
                '--install-dependency', install_dep,
                '--force',
                '--yes',
                '-e', ENV, '--json']
        try:
            p = subprocess.run(args, capture_output=True, text=True, timeout=900,
                               encoding='utf-8', errors='replace')
            out = (p.stdout or '') + '\n' + (p.stderr or '')
            clean = '\n'.join(l for l in out.splitlines()
                              if 'shim' not in l and 'dirname' not in l)
            ok = p.returncode == 0 and '"error"' not in clean
            results.append((n, ok, clean))
            print(f'  [{"OK" if ok else "FAIL"}] {n}')
            if not ok:
                print('      ' + clean.replace('\n', '\n      ')[:800])
        except subprocess.TimeoutExpired:
            results.append((n, False, 'TIMEOUT'))
            print(f'  [TIMEOUT] {n}')
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gen-only', action='store_true')
    ap.add_argument('--deploy', action='store_true')
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--no-install-dep', action='store_true')
    args = ap.parse_args()

    # --only 时不覆盖 cloudbaserc.json：
    # 那个文件是「全量函数声明」，被 --only 覆盖成单个函数后，
    # 后续 `tcb fn deploy --all` 只会认这一个函数。
    # 单独部署某个函数不需要它 —— deploy() 直接传 --runtime/--install-dependency。
    if args.only:
        names = args.only
        p = os.path.join(ROOT, 'cloudbaserc.json')
        print(f'仅部署指定函数（不改动 cloudbaserc.json）: {", ".join(names)}')
    else:
        p, names = gen_config(args.only)
        print(f'已生成 {p}')
    print(f'  envId: {ENV}')
    print(f'  runtime: {RUNTIME}')
    print(f'  环境变量: {ENV_VARS}')
    print(f'  函数数: {len(names)}')
    print()

    if args.gen_only or not args.deploy:
        return 0

    print('=== 部署云函数 ===')
    res = deploy(names, 'false' if args.no_install_dep else 'true')
    ok = sum(1 for _, o, _ in res if o)
    print()
    print(f'=== 结果：成功 {ok} / {len(res)} ===')
    failed = [n for n, o, _ in res if not o]
    if failed:
        print('  失败:', failed)
    return 0 if ok == len(res) else 1


if __name__ == '__main__':
    sys.exit(main())
