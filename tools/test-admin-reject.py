"""端到端验证管理员驳回：造一条 reviewQueue + 帖子，走完整流程。

因为 adminReview 需要 openid（CLI 调用没有），这里直接验证云函数的核心逻辑：
  1. 队列状态 pending → 能被条件更新占用（防双审）
  2. reject 时帖子 status 改成 rejected + rejectReason 写入
  3. 重复处理返回 40904

方法：直接操作数据库模拟云函数的每一步（等价于 adminReview 的逻辑），
验证数据流是否通。真正的前端链路由 node 模拟验证（见 test-admin-reject.js）。
"""
import json
import subprocess
import time

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'yyq-d6g1dv0kgf893afe8'
MY_UID = '080954836ae07a5b0040a26908637ad3'


def run(cmds, t=180):
    c = json.dumps(cmds, ensure_ascii=False)
    p = subprocess.run([NODE, CLI, 'db', 'nosql', 'execute', '--command', c,
                        '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=t,
                       encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return '\n'.join(l for l in o.splitlines()
                     if 'shim' not in l and 'dirname' not in l)


def query(coll, flt=None, limit=20, proj=None):
    cmd = {'find': coll, 'filter': flt or {}, 'limit': limit}
    if proj:
        cmd['projection'] = proj
    out = run([{'TableName': coll, 'CommandType': 'QUERY',
                'Command': json.dumps(cmd)}])
    try:
        return json.loads(out)['data']['results'][0]
    except Exception:
        return []


print('=== 1. 造一条待审帖子 + 队列记录 ===')
post_id = 'test-reject-post-1'
queue_id = 'test-reject-queue-1'
now = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())

post_doc = {
    '_id': post_id, 'shortId': 'TESTRJ', 'authorUid': MY_UID, 'board': 'life',
    'title': '测试驳回用帖子', 'content': '这条用来验证管理员驳回功能',
    'excerpt': '这条用来验证管理员驳回功能', 'media': [], 'coverFileId': '',
    'fields': {}, 'status': 'pending',
    'risk': {'level': 'review', 'source': 'local', 'labels': [], 'checkedAt': now},
    'clientReqId': 'test-reject-req', 'tags': [], 'aiSummary': '',
    'searchTokens': [], 'stats': {'likeCount': 0, 'favCount': 0, 'commentCount': 0,
                                  'citedCount': 0, 'viewCount': 0},
    'commentSeq': 0, 'hotScore': 0.01, 'publishedAt': None,
    'createdAt': now, 'updatedAt': now, 'aiStructured': False,
}
queue_doc = {
    '_id': queue_id, 'targetType': 'post', 'targetId': post_id,
    'source': 'wx', 'aiLabel': '待人工判定', 'reason': '', 'priority': 5,
    'status': 'pending', 'createdAt': now,
}
for coll, doc in [('posts', post_doc), ('reviewQueue', queue_doc)]:
    cmd = {'insert': coll, 'documents': [doc]}
    out = run([{'TableName': coll, 'CommandType': 'INSERT',
                'Command': json.dumps(cmd)}])
    print(f"  {coll}: {'已插入' if '\"error\"' not in out else out[:120]}")

print()
print('=== 2. 模拟 adminReview 的 reject 分支 ===')
# 2.1 条件更新占用队列（防双审）
cmd = {'update': 'reviewQueue', 'updates': [{
    'q': {'_id': queue_id, 'status': 'pending'},
    'u': {'$set': {'status': 'rejected', 'reviewerUid': MY_UID,
                   'handledBy': MY_UID, 'reviewedAt': now, 'handledAt': now,
                   'reviewNote': '测试驳回原因', 'updatedAt': now}},
    'multi': False}]}
out = run([{'TableName': 'reviewQueue', 'CommandType': 'UPDATE',
            'Command': json.dumps(cmd)}])
print(f"  队列占用: {'成功' if '\"error\"' not in out else out[:150]}")

q = query('reviewQueue', {'_id': queue_id}, 1)
print(f"  队列状态现在是: {q[0].get('status') if q else '查不到'}")

# 2.2 改帖子状态
cmd2 = {'update': 'posts', 'updates': [{
    'q': {'_id': post_id},
    'u': {'$set': {'status': 'rejected', 'rejectReason': '测试驳回原因',
                   'updatedAt': now}},
    'multi': False}]}
out2 = run([{'TableName': 'posts', 'CommandType': 'UPDATE',
             'Command': json.dumps(cmd2)}])
print(f"  帖子改状态: {'成功' if '\"error\"' not in out2 else out2[:150]}")

p = query('posts', {'_id': post_id}, 1)
if p:
    print(f"  帖子状态现在是: status={p[0].get('status')}  rejectReason={p[0].get('rejectReason')!r}")

print()
print('=== 3. 验证「多次驳回」被正确拦住（40904 路径）===')
cmd3 = {'update': 'reviewQueue', 'updates': [{
    'q': {'_id': queue_id, 'status': 'pending'},   # 已经不是 pending → 不该更新成功
    'u': {'$set': {'reviewNote': '二次占用'}}, 'multi': False}]}
out3 = run([{'TableName': 'reviewQueue', 'CommandType': 'UPDATE',
             'Command': json.dumps(cmd3)}])
# 裸 MongoDB 返回结构是 {n, nModified}：n=0 表示没有记录匹配到条件
n_matched = None
try:
    n_matched = json.loads(out3)['data']['results'][0][0].get('n')
    if isinstance(n_matched, dict):
        # MongoDB 扩展类型 {"$numberInt": "0"}
        for k in ('$numberInt', '$numberLong', '$numberDouble'):
            if k in n_matched:
                n_matched = int(float(n_matched[k]))
                break
except Exception:
    pass
if n_matched is None:
    print('  ⚠️ 无法解析返回值:', out3[:200])
elif str(n_matched) == '0':
    print('  ✅ 二次占用被拒（n=0，无记录匹配 status=pending）→ 云函数会返回 40904')
else:
    print(f'  ❌ 二次占用又成功了（n={n_matched}）→ 防双审失效')
q2 = query('reviewQueue', {'_id': queue_id}, 1)
print(f"  队列状态仍为: {q2[0].get('status') if q2 else '?'}")
print(f"  reviewNote: {q2[0].get('reviewNote')!r}（应仍为「测试驳回原因」，未被二次覆盖）")

print()
print('=== 4. 已处理的帖子不再出现在 pending tab ===')
pend = query('reviewQueue', {'status': 'pending', 'source': {'$ne': 'report'}}, 20)
print(f"  pending tab 现在有 {len(pend)} 条")
for x in pend:
    print(f"    {str(x.get('_id'))[:20]}  targetId={str(x.get('targetId'))[:20]}")

print()
print('=== 5. 清理测试数据 ===')
for coll, doc_id in [('posts', post_id), ('reviewQueue', queue_id)]:
    cmd = {'delete': coll, 'deletes': [{'q': {'_id': doc_id}, 'limit': 1}]}
    run([{'TableName': coll, 'CommandType': 'DELETE', 'Command': json.dumps(cmd)}])
left_p = query('posts', {'_id': post_id}, 1)
left_q = query('reviewQueue', {'_id': queue_id}, 1)
print(f"  残留: posts={len(left_p)} reviewQueue={len(left_q)} {'✅ 已清空' if not left_p and not left_q else '❌'}")
