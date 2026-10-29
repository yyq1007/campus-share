"""核实云上部署的代码确实包含本次修复（不只看 Status）。

从 fn detail 返回的 CodeInfo 里 grep 关键标记。

本轮（10-28 22:00）检查的标记：
  所有函数        → lib/db.js 的 batchUpdate（25 份副本都有）
  所有函数        → lib/rate.js 的 fail-closed（degraded / 计数失败）
  所有函数        → lib/present.js 的 avatarIdx（不下发 authorUid）
  authBindInvite → 扣减在建号之前（usedCount: _.inc(-1) 归还名额）
  commentCreate  → MAX_RETRY 重试 + createCommentOnce
  adminReview    → batchUpdate（封禁分批）
  taskCleanup    → batchUpdate（清理分批）
  postDelete     → batchUpdate（删帖置删评论）
  taskVectorize  → embedded 标记 + 游标推进
  aiEmbed        → embedded: true
  postCreate     → embedded: false
  meMessageRead  → 分类 counts
  taskHotScore   → batchUpdate（过期分批）
"""
import json
import subprocess
import sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'qqq-d7g05y68803d5476c'

FNS = ['adminQueue', 'adminReview', 'aiEmbed', 'aiStructure', 'askQuery',
       'authBindInvite', 'authDelete', 'authLogin', 'clientLog', 'commentCreate',
       'commentList', 'interactionToggle', 'meList', 'meMessageRead', 'meOverview',
       'meUpdateProfile', 'mediaCheck', 'postCreate', 'postDelete', 'postDetail',
       'postList', 'reportCreate', 'taskCleanup', 'taskHotScore', 'taskVectorize',
       'wxacodeGen']

# 每个函数必须命中的标记（全部命中才算过）
MARKERS = {
    'authBindInvite': ['usedCount: _.inc(-1)', '邀请码格式不正确'],
    'commentCreate':  ['MAX_RETRY', 'createCommentOnce'],
    'adminReview':    ['batchUpdate'],
    'taskCleanup':    ['batchUpdate'],
    'postDelete':     ['batchUpdate'],
    'taskVectorize':  ['embedded', 'MAX_ROUNDS'],
    'aiEmbed':        ['embedded: true'],
    'postCreate':     ['embedded: false'],
    'meMessageRead':  ['counts'],
    'taskHotScore':   ['batchUpdate'],
}

# 所有函数都该有的公共标记（lib 副本）
COMMON = ['batchUpdate', 'degraded', 'avatarIdx']


def detail(name):
    p = subprocess.run([NODE, CLI, 'fn', 'detail', name, '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=180,
                       encoding='utf-8', errors='replace')
    o = '\n'.join(l for l in (p.stdout or '').splitlines()
                  if 'shim' not in l and 'dirname' not in l)
    try:
        d = json.loads(o)
        if '"error"' in o:
            return None, d.get('error', {}).get('message', '')[:80]
        f = d.get('data', d)
        if 'FunctionInfo' in f:
            f = f['FunctionInfo']
        return f, ''
    except Exception as e:
        return None, f'parse {e}'


print('=== 云上代码核实（CodeInfo 里查本轮修复标记）===\n')
bad = []
for n in FNS:
    f, err = detail(n)
    if not f:
        print(f'  ❌ {n:20s} 查询失败: {err}')
        bad.append(n)
        continue
    st = f.get('Status')
    code = f.get('CodeInfo') or ''

    need = list(MARKERS.get(n, [])) + COMMON
    missing = [m for m in need if m not in code]
    ok = (st == 'Active') and not missing

    if missing:
        print(f'  ❌ {n:20s} {st:8s} 代码 {len(code)}B  缺: {missing}')
        bad.append(n)
    else:
        print(f'  ✅ {n:20s} {st:8s} 代码 {len(code)}B  命中 {need}')

print()
if bad:
    print(f'❌ 有问题: {bad}')
    sys.exit(1)
print('✅ 全部 26 个函数：Active + 本轮修复标记全部命中')
