"""把 db.js 的 batchUpdate helper 同步到全部 25 份副本。

背景：每个云函数目录都有一份 lib/db.js。改之前 24 份 md5 相同，
只有 authBindInvite 那份多一个 `invites: 'invites'` 集合（它要用）。

所以这里不能用「整份覆盖」的方式同步（会把 invites 覆盖掉），
而是用「文本插入」：把基准文件里的 batchUpdate 函数原文抽出来，
插到各副本 module.exports 之前，并在 exports 对象里补上 batchUpdate 一行。
这样各副本原有差异完整保留。

helper 文本直接从基准文件抽取，不在本脚本里另写一份，避免两处维护跑偏。

幂等：已含 batchUpdate 的副本会跳过。
"""
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CF = os.path.join(ROOT, 'cloudfunctions')

SRC = os.path.join(CF, 'authLogin', 'lib', 'db.js')
MARK = 'async function batchUpdate'


def extract_helper(text):
    """从基准文件抽出 helper 函数（含前置注释块）。

    返回 (helper_text, needs_export_patch)
    needs_export_patch=True 表示基准的 exports 里还没有 batchUpdate 这一行。
    """
    m = re.search(r'(/\*\*\n \* 批量更新.*?\n\}\n)', text, re.S)
    if not m:
        return None, False
    helper = m.group(1)
    needs_export = not re.search(r'^\s*batchUpdate,\s*$', text, re.M)
    return helper, needs_export


def main():
    if not os.path.isfile(SRC):
        print('❌ 基准不存在:', SRC)
        return 1
    base = open(SRC, encoding='utf-8').read()
    helper, needs_export = extract_helper(base)
    if not helper:
        print('❌ 基准里找不到 batchUpdate helper')
        return 1
    if needs_export:
        print('❌ 基准的 module.exports 里缺 batchUpdate')
        return 1

    changed, skipped, failed = [], [], []

    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'db.js')
        if not os.path.isfile(p):
            continue
        if os.path.abspath(p) == os.path.abspath(SRC):
            skipped.append(f'{fn}（基准）')
            continue
        t = open(p, encoding='utf-8').read()
        if MARK in t:
            skipped.append(f'{fn}（已含）')
            continue

        # 1) 在 module.exports 之前插入 helper
        idx = t.find('module.exports = {')
        if idx < 0:
            failed.append(f'{fn}（找不到 module.exports）')
            continue
        t2 = t[:idx] + helper + '\n' + t[idx:]

        # 2) 在 exports 对象里补 batchUpdate（插在 decodeCursor 之后）
        if not re.search(r'^\s*decodeCursor,\s*$', t2, re.M):
            failed.append(f'{fn}（exports 里找不到 decodeCursor）')
            continue
        t2 = re.sub(r'^(\s*decodeCursor,\s*)$', r'\1\n  batchUpdate,', t2, count=1, flags=re.M)

        open(p, 'w', encoding='utf-8').write(t2)
        changed.append(fn)

    print(f'=== 同步完成：改动 {len(changed)} 个 ===')
    for c in changed:
        print('  ', c)
    print(f'  跳过 {len(skipped)} 个: {", ".join(skipped)}')
    if failed:
        print(f'  ❌ 失败 {len(failed)} 个: {", ".join(failed)}')

    # 复核
    print('\n=== 复核 ===')
    bad = []
    n = 0
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'db.js')
        if not os.path.isfile(p):
            continue
        n += 1
        t = open(p, encoding='utf-8').read()
        if MARK not in t or not re.search(r'^\s*batchUpdate,\s*$', t, re.M):
            bad.append(fn)
    print(f'  含 helper + 导出的副本: {n - len(bad)}/{n}')
    if bad:
        print('  ❌ 异常:', bad)

    ab = open(os.path.join(CF, 'authBindInvite', 'lib', 'db.js'), encoding='utf-8').read()
    print(f'  authBindInvite 的 invites 集合是否保留: {"invites:" in ab}')

    # helper 正文是否各副本一致（抽出来比 md5 片段）
    print('\n=== 各副本 helper 正文一致性 ===')
    hh = {}
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'db.js')
        if not os.path.isfile(p):
            continue
        t = open(p, encoding='utf-8').read()
        m = re.search(r'/\*\*\n \* 批量更新.*?\n\}\n', t, re.S)
        h = hashlib.md5((m.group(0) if m else '').encode('utf-8')).hexdigest()[:8]
        hh.setdefault(h, []).append(fn)
    for k, v in hh.items():
        print(f'  {k}: {len(v)} 个')

    return 0 if not bad and not failed else 1


if __name__ == '__main__':
    sys.exit(main())
