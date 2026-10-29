"""备份 collections 里的文档到本地 JSON（修 bug 前做保险）。

用法：
    python tools/backup-db.py            # 备份所有集合
    python tools/backup-db.py --restore  # 从备份恢复
"""
import json
import os
import subprocess
import sys

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'yyq-d6g1dv0kgf893afe8'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAK = os.path.join(ROOT, '.db-backup')

COLLECTIONS = ['users', 'posts', 'comments', 'interactions', 'reports', 'reviewQueue',
               'messages', 'configs', 'qaLogs', 'vectors', 'invites', 'inviteCodes',
               'mediaAssets', 'auditLogs', 'rateLimits', 'sensitiveWords', 'qrcodes',
               'idempotency']


def run(cmds, t=180):
    c = json.dumps(cmds, ensure_ascii=False)
    p = subprocess.run([NODE, CLI, 'db', 'nosql', 'execute', '--command', c,
                        '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=t,
                       encoding='utf-8', errors='replace')
    o = (p.stdout or '') + '\n' + (p.stderr or '')
    return '\n'.join(l for l in o.splitlines()
                     if 'shim' not in l and 'dirname' not in l)


def plain(v):
    """把 MongoDB 扩展类型转成普通值"""
    if isinstance(v, dict):
        if '$numberInt' in v:
            try: return int(v['$numberInt'])
            except: return 0
        if '$numberLong' in v:
            try: return int(v['$numberLong'])
            except: return 0
        if '$numberDouble' in v:
            try: return float(v['$numberDouble'])
            except: return 0
        if '$date' in v:
            return str(v['$date'])
        return {k: plain(x) for k, x in v.items()}
    if isinstance(v, list):
        return [plain(x) for x in v]
    return v


def backup():
    os.makedirs(BAK, exist_ok=True)
    total = 0
    for c in COLLECTIONS:
        out = run([{'TableName': c, 'CommandType': 'QUERY',
                    'Command': json.dumps({'find': c, 'filter': {}})}])
        try:
            docs = json.loads(out)['data']['results'][0]
        except Exception:
            docs = []
        p = os.path.join(BAK, f'{c}.json')
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(plain(docs), f, ensure_ascii=False, indent=2)
        total += len(docs)
        print(f'  {c:16s} {len(docs):4d} 条')
    print(f'\n共备份 {total} 条文档 → {BAK}')
    return 0


def restore():
    if not os.path.isdir(BAK):
        print('❌ 没有备份目录')
        return 1
    for c in COLLECTIONS:
        p = os.path.join(BAK, f'{c}.json')
        if not os.path.isfile(p):
            continue
        docs = json.load(open(p, encoding='utf-8'))
        if not docs:
            continue
        # 按 _id upsert 恢复
        for d in docs:
            if '_id' in d:
                out = run([{'TableName': c, 'CommandType': 'UPDATE',
                            'Command': json.dumps({'update': c, 'updates': [
                                {'q': {'_id': d['_id']}, 'u': {'$set': d},
                                 'upsert': True, 'multi': False}]})}])
        print(f'  {c:16s} 已恢复 {len(docs)} 条')
    return 0


if __name__ == '__main__':
    sys.exit(restore() if '--restore' in sys.argv else backup())
