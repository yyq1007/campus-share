"""把 rate.js 的 fail-closed 修复同步到全部 25 份副本。

背景：每个云函数目录都有一份 lib/rate.js（改之前 md5 完全相同），
改一份必须同步其余，否则行为不一致（有的 fail-open 有的 fail-closed）。

修复内容（B9）：限流异常路径不再「直接放行」。
  - 计数补得上 → 读回真实 count 再判断
  - 计数补不上 → fail-closed（拒绝），并打日志

本脚本幂等：以 authLogin 那份为基准，覆盖到其余 24 份，
最后复核所有副本 md5 一致。
"""
import hashlib
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CF = os.path.join(ROOT, 'cloudfunctions')

# 基准：authLogin 那份（已修好）
SRC = os.path.join(CF, 'authLogin', 'lib', 'rate.js')

MARK = 'fail-closed'


def main():
    if not os.path.isfile(SRC):
        print('❌ 基准文件不存在:', SRC)
        return 1
    base = open(SRC, encoding='utf-8').read()
    if MARK not in base:
        print('❌ 基准文件还没修好（缺少 %s 标记），先改它' % MARK)
        return 1

    changed, skipped = [], []
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'rate.js')
        if not os.path.isfile(p):
            continue
        if os.path.abspath(p) == os.path.abspath(SRC):
            skipped.append(f'{fn}（基准）')
            continue
        cur = open(p, encoding='utf-8').read()
        if cur == base:
            skipped.append(f'{fn}（已一致）')
            continue
        shutil.copyfile(SRC, p)
        changed.append(fn)

    print(f'=== 同步完成：改动 {len(changed)} 个 ===')
    for c in changed:
        print('  ', c)
    print(f'  跳过 {len(skipped)} 个: {", ".join(skipped)}')

    print('\n=== 复核（所有副本 md5 应相同）===')
    hashes = {}
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'rate.js')
        if os.path.isfile(p):
            h = hashlib.md5(open(p, 'rb').read()).hexdigest()[:8]
            hashes.setdefault(h, []).append(fn)
    for h, fns in hashes.items():
        print(f'  {h}: {len(fns)} 个')
    return 0 if len(hashes) == 1 else 1


if __name__ == '__main__':
    sys.exit(main())
