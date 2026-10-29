"""修正 users 集合的索引：把错误的 idx_uid 换成 idx_openid 唯一索引。

背景：
- 索引规格是从 README 抄的「users.uid 唯一」，但**逐字段核验后发现
  原作者的代码从不写 users.uid 字段**，所有查询用的都是 where({_id: ctx.uid})。
- `users.uid` 唯一索引的实际危害：无 uid 的文档全部视为 null →
  第二个真实用户登录建号时撞 E11000 → **注册直接失败**。
- 真正的登录唯一键是 `openid`（authLogin 用 where({openid}) 查已有账号）。

所以：删掉 idx_uid，保留/重建 idx_openid 为唯一索引。
"""
import json
import subprocess
import sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'qqq-d7g05y68803d5476c'


def run(cmds, t=150):
    c = json.dumps(cmds, ensure_ascii=False)
    p = subprocess.run([NODE, CLI, 'db', 'nosql', 'execute', '--command', c,
                        '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=t,
                       encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return '\n'.join(l for l in o.splitlines()
                     if 'shim' not in l and 'dirname' not in l)


def cmd(c):
    return [{'TableName': 'users', 'CommandType': 'COMMAND',
             'Command': json.dumps(c)}]


print('=== 1. 删掉错误的 idx_uid（users.uid 唯一索引）===')
out = run(cmd({'dropIndexes': 'users', 'index': 'idx_uid'}))
if '"error"' in out:
    print('  ' + out[:250])
else:
    print('  已删除')

print()
print('=== 2. 确保 idx_openid 是唯一索引 ===')
# 先删后建（幂等）
run(cmd({'dropIndexes': 'users', 'index': 'idx_openid'}))
out = run(cmd({
    'createIndexes': 'users',
    'indexes': [{'key': {'openid': 1}, 'name': 'idx_openid', 'unique': True}],
}))
if rc == 0 and '"error"' not in out:
    print('  已创建 idx_openid（unique）')
else:
    print('  失败: ' + out[:400])
print()
print('=== 3. 检查现有 openid 是否有重复 ===')
out = run([{'TableName': 'users', 'CommandType': 'QUERY',
                'Command': json.dumps({'find': 'users', 'filter': {},
                                       'projection': {'openid': 1, '_id': 1}})}])
try:
    docs = json.loads(out)['data']['results'][0]
    oids = [d.get('openid') for d in docs if d.get('openid')]
    dup = [x for x in set(oids) if oids.count(x) > 1]
    print(f'  {len(docs)} 条用户，{len(oids)} 条有 openid，重复: {dup or "无 ✅"}')
except Exception as e:
    print('  parse:', e, out[:200])

print()
print('=== 4. 最终索引列表 ===')
out = run(cmd({'listIndexes': 'users'}))
idx = []


def collect(node):
    if isinstance(node, dict):
        if 'key' in node and 'name' in node:
            idx.append((node['name'], node.get('unique', False)))
            return
        for v in node.values():
            collect(v)
    elif isinstance(node, list):
        for v in node:
            collect(v)


try:
    collect(json.loads(out).get('data', {}))
except Exception:
    pass
for n, u in sorted(set(idx)):
    print(f'  {n:24s} unique={u}')

print()
print('=== 5. 清理 users.uid 字段（这字段没人用，留着只会误导）===')
out = run([{'TableName': 'users', 'CommandType': 'UPDATE',
                'Command': json.dumps({'update': 'users', 'updates': [
                    {'q': {'uid': {'$exists': True}}, 'u': {'$unset': {'uid': ''}},
                     'multi': True}]})}])
if '"error"' in out:
    print('  ' + out[:250])
else:
    print('  已清除 uid 字段')
