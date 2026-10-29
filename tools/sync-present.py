"""把 present.js 的 commentItem 修复同步到全部 25 份副本。

背景：每个云函数目录都有一份 lib/present.js（内容原本逐字相同）。
10-28 修了 commentList / commentCreate 两份的 commentItem（加 uid 参数、
算 isMine、不下发 authorUid），但其余 23 份仍是旧版：
    function commentItem(c, replies) → 直接下发 authorUid
虽然目前只有 commentList/commentCreate 调用它，但留着这份"会泄露 uid"
的实现是个隐患 —— 将来谁调用了就把 authorUid 泄露出去了。

本脚本把 25 份统一成同一个版本：
  - commentItem(c, replies, uid)：算 isMine、不下发 authorUid
  - avatarIdx：按 floor 派生的糖果色序号（按作者派生会重建作者画像）
  - 导出 avatarIndex 供其他模块使用

幂等：以 commentList 那份为基准，已一致则跳过。
"""
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CF = os.path.join(ROOT, 'cloudfunctions')

SRC = os.path.join(CF, 'commentList', 'lib', 'present.js')
MARK = 'avatarIdx: avatarIndex(c.floor)'


def main():
    if not os.path.isfile(SRC):
        print('❌ 基准不存在:', SRC)
        return 1
    base = open(SRC, encoding='utf-8').read()
    if MARK not in base:
        print('❌ 基准还没修好（缺少 %s）' % MARK)
        return 1

    changed, skipped = [], []
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'present.js')
        if not os.path.isfile(p):
            continue
        if os.path.abspath(p) == os.path.abspath(SRC):
            skipped.append(f'{fn}（基准）')
            continue
        cur = open(p, encoding='utf-8').read()
        if cur == base:
            skipped.append(f'{fn}（已一致）')
            continue
        # 整份覆盖：present.js 各副本原本逐字相同，无局部差异
        open(p, 'w', encoding='utf-8').write(base)
        changed.append(fn)

    print(f'=== 同步完成：改动 {len(changed)} 个 ===')
    for c in changed:
        print('  ', c)
    print(f'  跳过 {len(skipped)} 个: {", ".join(skipped)}')

    # 复核：全仓不应再有下发 authorUid 的 commentItem
    print('\n=== 复核 1：是否还有 commentItem 下发 authorUid ===')
    bad = []
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'present.js')
        if not os.path.isfile(p):
            continue
        t = open(p, encoding='utf-8').read()
        m = re.search(r'function commentItem\(.*?\n\}', t, re.S)
        if not m:
            bad.append(f'{fn}（无 commentItem）')
            continue
        body = m.group(0)
        leaks = re.findall(r'^\s*authorUid\s*:', body, re.M)
        if leaks:
            bad.append(f'{fn}（仍下发 authorUid）')
    if bad:
        for b in bad:
            print('  ❌', b)
    else:
        print('  ✅ 25 份都不下发 authorUid')

    print('\n=== 复核 2：md5 分组 ===')
    hashes = {}
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'lib', 'present.js')
        if os.path.isfile(p):
            h = hashlib.md5(open(p, 'rb').read()).hexdigest()[:8]
            hashes.setdefault(h, []).append(fn)
    for h, fns in hashes.items():
        print(f'  {h}: {len(fns)} 个')

    print('\n=== 复核 3：commentItem 调用点都传了 uid ===')
    for fn in sorted(os.listdir(CF)):
        p = os.path.join(CF, fn, 'index.js')
        if not os.path.isfile(p):
            continue
        for i, ln in enumerate(open(p, encoding='utf-8').read().split('\n'), 1):
            if 'commentItem(' in ln and 'function commentItem' not in ln:
                has_uid = 'ctx.uid' in ln
                print(f'  {"✅" if has_uid else "❌"} {fn}/index.js:{i}: {ln.strip()[:100]}')

    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
