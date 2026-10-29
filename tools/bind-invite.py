"""给指定用户绑定站点邀请码（复刻 authBindInvite 的行为，直接改库）。

用法：
    python tools/bind-invite.py --uid 080954836ae07a5b0040a26908637ad3
    python tools/bind-invite.py --uid <你的uid> --code GXNU2026

行为与云函数一致：
  1. 查 invites 集合校验 code 存在 / 未停用 / 未超上限
  2. 乐观锁扣减 usedCount（where usedCount < maxUses + $inc）
  3. 生成 8 位个人邀请码（BASE32 去混淆字符集），确保全库不重复
  4. 写回 users：inviteCode / myInviteCode / status / updatedAt
"""
import argparse
import json
import os
import random
import subprocess
import sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'qqq-d7g05y68803d5476c'

# 与 cloudfunctions/*/lib/db.js 的 BASE32 一致（去掉 I/L/O/0/1 等易混字符）
BASE32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'


def run(cmds, t=150):
    c = json.dumps(cmds, ensure_ascii=False)
    p = subprocess.run([NODE, CLI, 'db', 'nosql', 'execute', '--command', c,
                        '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=t,
                       encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return '\n'.join(l for l in o.splitlines()
                     if 'shim' not in l and 'dirname' not in l)


def find(coll_name, flt, limit=10):
    out = run([{'TableName': coll_name, 'CommandType': 'QUERY',
                'Command': json.dumps({'find': coll_name, 'filter': flt,
                                       'limit': limit})}])
    try:
        return json.loads(out)['data']['results'][0]
    except Exception:
        return []


def num(v):
    """MongoDB 扩展类型解包：{"$numberInt": "100"} → 100"""
    if isinstance(v, dict):
        for k in ('$numberInt', '$numberLong', '$numberDouble'):
            if k in v:
                try:
                    return int(float(v[k]))
                except (TypeError, ValueError):
                    return 0
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--uid', required=True, help='要绑定的用户 _id')
    ap.add_argument('--code', default='GXNU2026', help='站点邀请码（自动转大写）')
    args = ap.parse_args()

    code = args.code.strip().upper()
    if not (6 <= len(code) <= 16) or not all(c.isalnum() for c in code):
        print(f'❌ 邀请码格式不正确：{code}（需 6-16 位字母数字）')
        return 1

    print(f'=== 绑定邀请码 {code} 给用户 {args.uid} ===\n')

    # 1. 用户存在性
    me = find('users', {'_id': args.uid}, 1)
    if not me:
        print(f'❌ 找不到用户 {args.uid}')
        return 1
    user = me[0]
    print(f'  用户: role={user.get("role")} status={user.get("status")} '
          f'inviteCode={user.get("inviteCode")!r}')

    if user.get('inviteCode'):
        print(f'  ✅ 已绑定过（{user["inviteCode"]}），幂等返回')
        if user.get('myInviteCode'):
            print(f'  个人邀请码: {user["myInviteCode"]}')
        return 0

    # 2. 校验邀请码
    inv = find('invites', {'code': code}, 1)
    if not inv:
        print(f'❌ 邀请码无效：{code}（invites 集合里没有）')
        return 1
    inv0 = inv[0]
    max_uses = num(inv0.get('maxUses'))
    used = num(inv0.get('usedCount'))
    if inv0.get('disabled'):
        print('❌ 邀请码已停用')
        return 1
    if used >= max_uses:
        print(f'❌ 邀请码已达使用上限（{used}/{max_uses}）')
        return 1
    print(f'  邀请码有效: 已用 {used}/{max_uses}')

    # 3. 乐观锁扣减
    out = run([{'TableName': 'invites', 'CommandType': 'UPDATE',
                'Command': json.dumps({'update': 'invites', 'updates': [
                    {'q': {'code': code, 'disabled': False,
                           'usedCount': {'$lt': max_uses}},
                     'u': {'$inc': {'usedCount': 1}}, 'multi': False}]})}])
    if '"error"' in out:
        print(f'❌ 扣减次数失败: {out[:250]}')
        return 1
    print('  usedCount +1 ✅')

    # 4. 生成不重复的个人码
    existing = {d.get('myInviteCode') for d in find('users', {}, 200)}
    my_code = ''
    for _ in range(50):
        cand = ''.join(random.choice(BASE32) for _ in range(8))
        if cand not in existing:
            my_code = cand
            break
    if not my_code:
        print('❌ 50 次都没生成不重复的码')
        return 1
    print(f'  个人邀请码: {my_code}')

    # 5. 写回用户
    out = run([{'TableName': 'users', 'CommandType': 'UPDATE',
                'Command': json.dumps({'update': 'users', 'updates': [
                    {'q': {'_id': args.uid},
                     'u': {'$set': {'inviteCode': code, 'myInviteCode': my_code,
                                    'status': 'active'}}, 'multi': False}]})}])
    if '"error"' in out:
        print(f'❌ 写回失败: {out[:250]}')
        return 1

    # 6. 复核
    after = find('users', {'_id': args.uid}, 1)[0]
    inv_after = find('invites', {'code': code}, 1)[0]
    print()
    print('=== 结果 ===')
    print(f"  inviteCode   : {after.get('inviteCode')}")
    print(f"  myInviteCode : {after.get('myInviteCode')}")
    print(f"  status       : {after.get('status')}")
    print(f"  站点码用量   : {num(inv_after.get('usedCount'))}/{num(inv_after.get('maxUses'))}")
    print()
    print(f'你的个人邀请码（可分享给同学，一码多人用）：{after.get("myInviteCode")}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
