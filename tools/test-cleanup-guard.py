"""验证 taskCleanup 的"删除前二次校验"真的有效。

造 3 条 mediaAssets 测试记录：
  A. refCount=0 且被 posts.media 引用   → 期望：跳过（skipped+1），并把 refCount 置 1
  B. refCount=0 且无人引用              → 期望：删除（removed+1）
  C. refCount=1（正常在用）             → 期望：完全不动

跑完调用 taskCleanup，比对结果，最后清理测试数据。
"""
import json
import subprocess
import sys
import time

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'qqq-d7g05y68803d5476c'
MY_UID = '080954836ae07a5b0040a26908637ad3'
OLD = '2020-01-01T00:00:00.000Z'   # 远早于 1 天前，确保会被扫到

TEST_A = 'cloud://qqq-d7g05y68803d5476c.test/avatar/aa.jpg'   # 被帖子引用
TEST_B = 'cloud://qqq-d7g05y68803d5476c.test/avatar/bb.jpg'   # 无人引用
TEST_C = 'cloud://qqq-d7g05y68803d5476c.test/avatar/cc.jpg'   # refCount=1


def run(cmds, t=180):
    c = json.dumps(cmds, ensure_ascii=False)
    p = subprocess.run([NODE, CLI, 'db', 'nosql', 'execute', '--command', c,
                        '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=t,
                       encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return '\n'.join(l for l in o.splitlines()
                     if 'shim' not in l and 'dirname' not in l)


def find(flt):
    out = run([{'TableName': 'mediaAssets', 'CommandType': 'QUERY',
                'Command': json.dumps({'find': 'mediaAssets', 'filter': flt, 'limit': 50})}])
    try:
        return json.loads(out)['data']['results'][0]
    except Exception:
        return []


def invoke(fn):
    p = subprocess.run([NODE, CLI, 'fn', 'invoke', fn, '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=400,
                       encoding='utf-8', errors='replace')
    o = '\n'.join(l for l in (p.stdout or '').splitlines()
                  if 'shim' not in l and 'dirname' not in l)
    try:
        d = json.loads(o)
        r = d.get('data', d)
        ret = r.get('RetMsg', '')
        return json.loads(ret)
    except Exception as e:
        return {'_error': str(e), '_raw': o[:300]}


def cleanup():
    for fid in (TEST_A, TEST_B, TEST_C):
        run([{'TableName': 'mediaAssets', 'CommandType': 'DELETE',
              'Command': json.dumps({'delete': 'mediaAssets', 'deletes': [
                  {'q': {'fileId': fid}, 'limit': 1}]})}])


print('=== 准备测试数据 ===')
cleanup()
# 找一条真实帖子的 media.fileId（被引用的）
real_media = ''
posts = find({})
out = run([{'TableName': 'posts', 'CommandType': 'QUERY',
            'Command': json.dumps({'find': 'posts', 'filter': {}, 'limit': 20})}])
try:
    for d in json.loads(out)['data']['results'][0]:
        m = d.get('media') or []
        if m:
            real_media = m[0]['fileId']
            break
except Exception:
    pass
print(f'  真实帖子的 media.fileId: {real_media[:80] if real_media else "(无)"}')

docs = [
    {'_id': 'test-avatar-a', 'fileId': real_media or TEST_A, 'uid': MY_UID,
     'type': 'image', 'size': 100, 'mime': 'image/jpeg', 'w': 0, 'h': 0,
     'duration': 0, 'checkStatus': 'pass', 'checkSource': 'test',
     'refCount': 0, 'createdAt': OLD},
    {'_id': 'test-avatar-b', 'fileId': TEST_B, 'uid': MY_UID,
     'type': 'image', 'size': 100, 'mime': 'image/jpeg', 'w': 0, 'h': 0,
     'duration': 0, 'checkStatus': 'pass', 'checkSource': 'test',
     'refCount': 0, 'createdAt': OLD},
    {'_id': 'test-avatar-c', 'fileId': TEST_C, 'uid': MY_UID,
     'type': 'image', 'size': 100, 'mime': 'image/jpeg', 'w': 0, 'h': 0,
     'duration': 0, 'checkStatus': 'pass', 'checkSource': 'test',
     'refCount': 1, 'createdAt': OLD},
]
out = run([{'TableName': 'mediaAssets', 'CommandType': 'INSERT',
            'Command': json.dumps({'insert': 'mediaAssets', 'documents': docs})}])
print('  插入:', '成功' if '"error"' not in out else out[:200])
print(f'  A(被引用,refCount=0) fileId={docs[0]["fileId"][:60]}')
print(f'  B(无人用,refCount=0) fileId={TEST_B[:60]}')
print(f'  C(在用中,refCount=1) fileId={TEST_C[:60]}')

print()
print('=== 调用 taskCleanup ===')
res = invoke('taskCleanup')
print('  返回:', json.dumps(res, ensure_ascii=False))
media = res.get('media', {}) if isinstance(res, dict) else {}
print(f"  removed={media.get('removed')} failed={media.get('failed')} skipped={media.get('skipped')}")

print()
print('=== 复核（看三条记录还在不在、refCount 变了没）===')
left = {d.get('_id'): d for d in find({'_id': {'$in': ['test-avatar-a', 'test-avatar-b', 'test-avatar-c']}})}
a = left.get('test-avatar-a')
b = left.get('test-avatar-b')
c = left.get('test-avatar-c')
rc_a = (a or {}).get('refCount')
rc_a = rc_a.get('$numberInt') if isinstance(rc_a, dict) else rc_a
rc_c = (c or {}).get('refCount')
rc_c = rc_c.get('$numberInt') if isinstance(rc_c, dict) else rc_c

ok = True
if a is None:
    print('  ❌ A 被删了（它被帖子引用，应该跳过！）')
    ok = False
else:
    print(f'  ✅ A 还在，refCount={rc_a}（期望被置 1 → 说明二次校验生效）')
    if str(rc_a) != '1':
        print('     ⚠️ refCount 未被置 1')
if b is None:
    print('  ✅ B 被删了（没人引用，应该删）')
else:
    print('  ❌ B 没被删（它没人引用，应该删）')
    ok = False
if c is not None:
    print(f'  ✅ C 还在（refCount=1 不该动），refCount={rc_c}')
else:
    print('  ❌ C 被删了（refCount=1，不该删）')
    ok = False

print()
cleanup()
print('=== 测试数据已清理 ===')
print()
print('✅ 二次校验有效' if ok else '❌ 二次校验未生效')
sys.exit(0 if ok else 1)
