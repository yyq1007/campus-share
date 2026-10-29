"""给 3 个定时任务函数创建定时触发器。

cron 是 7 位（秒 分 时 日 月 周 年），频率取自 docs/MVP产品开发文档-v1.0.md：
    taskHotScore   每小时
    taskVectorize  每 5 分钟
    taskCleanup    每日 03:00

幂等：先查已有触发器，同名则先删再建。
"""
import json
import subprocess
import sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'yyq-d6g1dv0kgf893afe8'

TRIGGERS = [
    # 腾讯云 SCF 的 cron 是 7 位：秒 分 时 日 月 周 年
    ('taskHotScore', 'taskHotScoreTimer', '0 0 * * * * *', '每小时整点重算热度分'),
    ('taskVectorize', 'taskVectorizeTimer', '0 */5 * * * * *', '每 5 分钟重建向量索引'),
    ('taskCleanup', 'taskCleanupTimer', '0 0 3 * * * *', '每日 03:00 清理过期与临时文件'),
]


def run(args, t=180):
    p = subprocess.run([NODE, CLI] + args, capture_output=True, text=True,
                       timeout=t, encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return p.returncode, '\n'.join(l for l in o.splitlines()
                                   if 'shim' not in l and 'dirname' not in l)


def main():
    ok = 0
    for fn, tname, cron, desc in TRIGGERS:
        # 先删同名触发器（幂等）
        rc, out = run(['fn', 'trigger', 'delete', fn, tname, '-e', ENV, '--json'])
        if rc != 0 and 'not found' not in out.lower() and '"error"' in out:
            print(f'  [删旧触发器失败] {fn}/{tname}: {out[:200]}')

        rc, out = run(['fn', 'trigger', 'create', fn,
                       '--trigger-name', tname,
                       '--cron', cron,
                       '-e', ENV, '--json'])
        if rc == 0 and '"error"' not in out:
            print(f'  [OK] {fn}  cron={cron}  ({desc})')
            ok += 1
        else:
            print(f'  [FAIL] {fn}  cron={cron}: {out[:400]}')

    print()
    print(f'=== 触发器：成功 {ok} / {len(TRIGGERS)} ===')
    return 0 if ok == len(TRIGGERS) else 1


if __name__ == '__main__':
    sys.exit(main())
