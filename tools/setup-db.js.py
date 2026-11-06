"""在目标环境建 campus-share 需要的集合、索引与种子数据。

用 tcb CLI 的 db nosql execute（MongoDB 协议）实现：
  - create        建集合
  - createIndexes 建索引
  - insert        灌种子文档

幂等：已存在的集合跳过（幂等错误码忽略），索引重复时先 drop 再建。
"""
import json
import os
import subprocess
import sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'qqq-d7g05y68803d5476c'

# ── 集合与索引规格 ────────────────────────────────────────────────
# 字段名已逐条对照云函数源码核验：
#   sensitiveWords 用 term（不是 word）
#   configs 是单文档集合（_id='global'），无 key 字段
#   mediaAssets 只有 createdAt + refCount，无 cloudPath/windowStart
#   messages.dedupeKey 非唯一（8 类消息不传该字段 → 空串会撞唯一索引）
COLLECTIONS = [
    'users', 'posts', 'comments', 'interactions', 'reports', 'reviewQueue',
    'messages', 'configs', 'qaLogs', 'vectors', 'invites', 'inviteCodes',
    'mediaAssets', 'auditLogs', 'rateLimits', 'sensitiveWords', 'qrcodes',
    'idempotency',
]

INDEXES = {
    'users': [
        # ⚠️ 不要建 users.uid 索引：逐字段核验后发现原作者的代码**从不写也不读**
        # users.uid 字段（所有查询都是 where({_id: ctx.uid})，用的文档 _id）。
        # README 里「users 3 个（含 uid 唯一）」是笔误。
        # 若真建 uid 唯一索引 → 无 uid 的文档全视为 null → 第二个真实用户登录
        # 建号时撞 E11000 → 注册直接失败。
        # 真正的登录唯一键是 openid（authLogin 用 where({openid}) 查已有账号）。
        ('idx_openid', [('openid', 1)], True),
        ('idx_myInviteCode', [('myInviteCode', 1)], False),
        ('idx_deleteAt_status', [('deleteAt', 1), ('status', 1)], False),
        ('idx_role', [('role', 1)], False),
        ('idx_status', [('status', 1)], False),
    ],
    'posts': [
        ('idx_status_created', [('status', 1), ('createdAt', -1)], False),
        ('idx_board_hot', [('board', 1), ('hotScore', -1)], False),
        ('idx_uid_cited', [('uid', 1), ('citedCount', -1)], False),
        ('idx_shortId', [('shortId', 1)], True),
        ('idx_searchTokens_status', [('searchTokens', 1), ('status', 1)], False),
        ('idx_authorUid_status', [('authorUid', 1), ('status', 1)], False),
        ('idx_board_created', [('board', 1), ('createdAt', -1)], False),
        ('idx_publishedAt_status', [('publishedAt', 1), ('status', 1)], False),
    ],
    'comments': [
        ('idx_status', [('status', 1)], False),
        ('idx_authorUid_status', [('authorUid', 1), ('status', 1)], False),
        ('idx_parentId_status', [('parentId', 1), ('status', 1)], False),
        ('idx_postId', [('postId', 1)], False),
        ('idx_postId_floor', [('postId', 1), ('floor', 1)], False),
    ],
    'interactions': [
        ('idx_targetId_targetType', [('targetId', 1), ('targetType', 1)], False),
        ('idx_uid_target', [('uid', 1), ('targetId', 1), ('targetType', 1)], False),
    ],
    'reports': [
        ('idx_status_targetType', [('status', 1), ('targetType', 1)], False),
        ('idx_targetId', [('targetId', 1)], False),
    ],
    'reviewQueue': [
        ('idx_status', [('status', 1)], False),
        ('idx_source_status', [('source', 1), ('status', 1)], False),
    ],
    'messages': [
        ('idx_toUid_read', [('toUid', 1), ('read', 1)], False),
        ('idx_toUid_read_type', [('toUid', 1), ('read', 1), ('type', 1)], False),
        ('idx_dedupeKey', [('dedupeKey', 1)], False),
    ],
    'configs': [],
    'qaLogs': [
        ('idx_uid_created', [('uid', 1), ('createdAt', -1)], False),
    ],
    'vectors': [
        ('idx_postId', [('postId', 1)], False),
    ],
    'invites': [
        ('idx_code', [('code', 1)], True),
        ('idx_disabled_usedCount', [('disabled', 1), ('usedCount', 1)], False),
    ],
    'inviteCodes': [
        ('idx_code', [('code', 1)], True),
    ],
    'mediaAssets': [
        ('idx_created_refcount', [('createdAt', 1), ('refCount', 1)], False),
    ],
    'auditLogs': [
        ('idx_actor_created', [('actorUid', 1), ('createdAt', -1)], False),
    ],
    'rateLimits': [
        ('idx_windowStart', [('windowStart', 1)], False),
    ],
    'sensitiveWords': [
        ('idx_term', [('term', 1)], True),
        ('idx_enabled', [('enabled', 1)], False),
    ],
    'qrcodes': [
        ('idx_scene', [('scene', 1)], False),
    ],
    'idempotency': [
        ('idx_uid_clientReqId', [('uid', 1), ('clientReqId', 1)], False),
    ],
}

# ── 种子数据 ─────────────────────────────────────────────────────
# 时间字段用 ISO 字符串而非 $date —— 腾讯云 RunCommands 接口对扩展 JSON 类型的
# 校验较严，$date 会被判为 Check request parameter fail。
SEED = {
    'configs': [{
        '_id': 'global',
        'updatedAt': '2026-10-27T00:00:00.000Z',
    }],
    'invites': [{
        '_id': 'seed-gxnu2026',
        'code': 'GXNU2026',
        'maxUses': 100,
        'usedCount': 0,
        'disabled': False,
        'createdAt': '2026-10-27T00:00:00.000Z',
    }],
}


def run_nosql(commands, timeout=120):
    """执行一批 MongoDB 命令，返回 (exit_code, 解析后的 json 或原文)"""
    cmd = json.dumps(commands, ensure_ascii=False)
    args = [NODE, CLI, 'db', 'nosql', 'execute', '--command', cmd, '-e', ENV, '--json']
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                       encoding='utf-8', errors='replace')
    out = p.stdout or ''
    # 去掉 shim 噪音行
    clean = '\n'.join(l for l in out.splitlines() if 'shim' not in l and 'dirname' not in l)
    return p.returncode, clean.strip()


def list_collections():
    """返回环境里已存在的集合名集合"""
    rc, out = run_nosql([{
        'TableName': '',
        'CommandType': 'COMMAND',
        'Command': json.dumps({'listCollections': 1, 'filter': {}}),
    }])
    names = []

    def walk(node):
        if isinstance(node, dict):
            if 'name' in node and 'type' in node:
                names.append(node['name'])
                return
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    try:
        walk(json.loads(out).get('data', {}))
    except Exception:
        pass
    return set(names)


def main():
    ok_c, fail_c, skip_c = [], [], []

    print('=== 1. 建集合 ===')
    existing = list_collections()
    for coll in COLLECTIONS:
        if coll in existing:
            print(f'  [已存在] {coll}')
            skip_c.append(coll)
            continue
        rc, out = run_nosql([{
            'TableName': coll,
            'CommandType': 'COMMAND',
            'Command': json.dumps({'create': coll}),
        }])
        if rc == 0 and '"error"' not in out:
            print(f'  [建] {coll}')
            ok_c.append(coll)
        else:
            print(f'  [失败] {coll}: {out[:220]}')
            fail_c.append(coll)

    print()
    print('=== 2. 建索引 ===')
    idx_ok = idx_fail = idx_skip = 0
    for coll, items in INDEXES.items():
        for name, keys, unique in items:
            key_doc = {k: v for k, v in keys}
            spec = {'key': key_doc, 'name': name}
            if unique:
                spec['unique'] = True
            # 先删同名索引（幂等：重复部署时先删后建）
            run_nosql([{
                'TableName': coll,
                'CommandType': 'COMMAND',
                'Command': json.dumps({'dropIndexes': coll, 'index': name}),
            }])
            rc, out = run_nosql([{
                'TableName': coll,
                'CommandType': 'COMMAND',
                'Command': json.dumps({'createIndexes': coll, 'indexes': [spec]}),
            }])
            if rc == 0 and '"error"' not in out:
                idx_ok += 1
                print(f'  [建] {coll}.{name}')
            elif 'already exists' in out.lower():
                idx_skip += 1
                print(f'  [已存在] {coll}.{name}')
            else:
                idx_fail += 1
                print(f'  [失败] {coll}.{name}: {out[:200]}')
    print(f'\n  索引：成功 {idx_ok} / 已存在 {idx_skip} / 失败 {idx_fail}')

    print()
    print('=== 3. 种子数据 ===')
    for coll, docs in SEED.items():
        for doc in docs:
            # 先查是否已存在，避免重复插入
            q = json.dumps({'find': coll, 'filter': {'_id': doc['_id']}, 'limit': 1})
            rc, out = run_nosql([{'TableName': coll, 'CommandType': 'QUERY',
                                  'Command': q}])
            if '"_id"' in out:
                print(f'  [已存在] {coll}/{doc["_id"]}')
                continue
            rc, out = run_nosql([{
                'TableName': coll,
                'CommandType': 'INSERT',
                'Command': json.dumps({'insert': coll, 'documents': [doc]}),
            }])
            if rc == 0 and '"error"' not in out:
                print(f'  [插入] {coll}/{doc["_id"]}')
            else:
                print(f'  [失败] {coll}/{doc["_id"]}: {out[:220]}')

    print()
    print('=== 汇总 ===')
    print(f'  集合：成功 {len(ok_c)} / 已存在 {len(skip_c)} / 失败 {len(fail_c)}')
    if fail_c:
        print(f'  失败的集合: {fail_c}')
    print(f'  索引：成功 {idx_ok} / 已存在 {idx_skip} / 失败 {idx_fail}')
    return 1 if fail_c or idx_fail else 0


if __name__ == '__main__':
    sys.exit(main())
