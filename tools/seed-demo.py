"""灌演示数据：一个演示用户 + 4 条帖子 + 评论 + 互动。

数据结构严格对齐 postCreate / commentCreate / interactionToggle 的写入结构，
这样小程序拉列表、详情、互动都能正常显示。

幂等：按固定 _id 插入，重复执行会跳过已存在的。
"""
import json
import os
import random
import string
import subprocess
import sys
import time

NODE = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
CLI = r"C:\Users\Admin（无密码）\.workbuddy\binaries\node\workspace\node_modules\@cloudbase\cli\dist\standalone\cli.js"
ENV = 'yyq-d6g1dv0kgf893afe8'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'


def run_nosql(commands, timeout=120):
    cmd = json.dumps(commands, ensure_ascii=False)
    p = subprocess.run([NODE, CLI, 'db', 'nosql', 'execute', '--command', cmd,
                        '-e', ENV, '--json'],
                       capture_output=True, text=True, timeout=timeout,
                       encoding='utf-8', errors='replace')
    out = p.stdout or ''
    return p.returncode, '\n'.join(l for l in out.splitlines()
                                   if 'shim' not in l and 'dirname' not in l)


def find_one(coll, doc_id):
    rc, out = run_nosql([{'TableName': coll, 'CommandType': 'QUERY',
                          'Command': json.dumps({'find': coll, 'filter': {'_id': doc_id}})}])
    try:
        docs = json.loads(out)['data']['results'][0]
        return docs[0] if docs else None
    except Exception:
        return None


def insert(coll, doc):
    rc, out = run_nosql([{'TableName': coll, 'CommandType': 'INSERT',
                          'Command': json.dumps({'insert': coll, 'documents': [doc]})}])
    return rc == 0 and '"error"' not in out, out


def short_id():
    return ''.join(random.choice(BASE32) for _ in range(6))


def hot_score(like, fav, comment, cited, hours):
    w = 3 * like + 4 * fav + 5 * comment + 6 * cited
    return round((w + 1) / pow(hours + 2, 1.5), 4)


def iso(days_ago):
    ts = time.time() - days_ago * 86400
    return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(ts))


DEMO_UID = 'demo-user-1'
NOW = iso(0)


def build_user():
    return {
        '_id': DEMO_UID,
        'openid': 'demo-openid-0001',
        'anonNo': 'DEMO',
        'role': 'user',
        'status': 'active',
        'inviteCode': '',
        'credit': 100,
        'avatar': None,
        'stats': {'posts': 4, 'favs': 0, 'cited': 0},
        'privacyVersion': 'v1',
        'privacyAgreedAt': NOW,
        'createdAt': iso(30),
        'lastActiveAt': NOW,
        'updatedAt': NOW,
    }


def build_posts():
    """从 tools/seed-posts.json 读演示帖，转成 posts 集合的完整文档"""
    src = json.load(open(os.path.join(ROOT, 'tools', 'seed-posts.json'), encoding='utf-8'))
    docs = []
    for i, p in enumerate(src):
        days = 5 - i * 1.2
        like = p.get('likeCount', 0)
        fav = p.get('favCount', 0)
        comment = p.get('commentCount', 0)
        content = p.get('content', '')
        docs.append({
            '_id': f'demo-post-{i+1}',
            'shortId': p.get('shortId') or short_id(),
            'authorUid': p.get('uid', DEMO_UID),
            'board': p.get('board', 'life'),
            'title': p.get('title', ''),
            'content': content,
            'excerpt': content[:60],
            'media': p.get('media', []),
            'coverFileId': '',
            'fields': p.get('fields', {}),
            'status': p.get('status', 'published'),
            'risk': {'level': 'pass', 'source': 'local', 'labels': [], 'checkedAt': NOW},
            'clientReqId': f'demo-req-{i+1}',
            'tags': [],
            'aiSummary': '',
            'searchTokens': p.get('searchTokens', []),
            'stats': {
                'likeCount': like, 'favCount': fav,
                'commentCount': comment, 'citedCount': 0, 'viewCount': like * 4,
            },
            'commentSeq': p.get('commentSeq', comment),
            'hotScore': hot_score(like, fav, comment, 0, days * 24),
            'publishedAt': iso(days),
            'createdAt': iso(days),
            'updatedAt': iso(days),
            'aiStructured': False,
        })
    return docs


COMMENTS = [
    ('demo-post-1', '同款！三号窗口我也觉得香，学生证还能减两块', 'demo-user-2'),
    ('demo-post-1', '已经冲了，明天就去', 'demo-user-3'),
    ('demo-post-2', '高数笔记整理得太全了，已收藏', 'demo-user-2'),
    ('demo-post-3', '求具体在哪个窗口！', 'demo-user-4'),
]


def build_comments():
    docs = []
    for i, (post_id, text, uid) in enumerate(COMMENTS):
        docs.append({
            '_id': f'demo-comment-{i+1}',
            'postId': post_id,
            'parentId': '',
            'floor': i + 1,
            'authorUid': uid,
            'content': text,
            'status': 'published',
            'likeCount': i,
            'replyCount': 0,
            'createdAt': iso(3 - i * 0.5),
            'updatedAt': iso(3 - i * 0.5),
        })
    return docs


EXTRA_USERS = [
    ('demo-user-2', 'demo-openid-0002', '爱吃的小圆'),
    ('demo-user-3', 'demo-openid-0003', '图书馆常客'),
    ('demo-user-4', 'demo-openid-0004', '二食堂钉子户'),
]


def build_extra_users():
    docs = []
    for uid, openid, name in EXTRA_USERS:
        docs.append({
            '_id': uid,
            'openid': openid,
            'anonNo': uid[-2:].upper(),
            'role': 'user',
            'status': 'active',
            'inviteCode': '',
            'credit': 100,
            'avatar': None,
            'nickname': name,
            'stats': {'posts': 0, 'favs': 0, 'cited': 0},
            'privacyVersion': 'v1',
            'privacyAgreedAt': NOW,
            'createdAt': iso(20),
            'lastActiveAt': NOW,
            'updatedAt': NOW,
        })
    return docs


def update_doc(coll, doc_id, fields):
    """更新已有文档的字段"""
    sets = {k: v for k, v in fields.items()}
    rc, out = run_nosql([{
        'TableName': coll, 'CommandType': 'UPDATE',
        'Command': json.dumps({'update': coll, 'updates': [
            {'q': {'_id': doc_id}, 'u': {'$set': sets}, 'multi': False}]}),
    }])
    return rc == 0 and '"error"' not in out, out


def main():
    print('=== 灌演示数据 ===\n')

    # 1. 用户
    users = [build_user()] + build_extra_users()
    for u in users:
        if find_one('users', u['_id']):
            print(f'  [已存在] users/{u["_id"]}')
            continue
        ok, out = insert('users', u)
        print(f'  [{"插入" if ok else "失败"}] users/{u["_id"]}')
        if not ok:
            print('      ' + out[:250])

    # 2. 帖子
    for d in build_posts():
        if find_one('posts', d['_id']):
            print(f'  [已存在] posts/{d["_id"]}')
            continue
        ok, out = insert('posts', d)
        print(f'  [{"插入" if ok else "失败"}] posts/{d["_id"]}  {d["title"][:24]}')
        if not ok:
            print('      ' + out[:250])

    # 3. 评论
    for d in build_comments():
        if find_one('comments', d['_id']):
            print(f'  [已存在] comments/{d["_id"]}')
            continue
        ok, out = insert('comments', d)
        print(f'  [{"插入" if ok else "失败"}] comments/{d["_id"]}')
        if not ok:
            print('      ' + out[:250])

    print()
    print('=== 校验 ===')
    for coll, ids in [('users', [u['_id'] for u in users]),
                       ('posts', [f'demo-post-{i+1}' for i in range(4)]),
                       ('comments', [f'demo-comment-{i+1}' for i in range(4)])]:
        n = sum(1 for i in ids if find_one(coll, i))
        print(f'  {coll}: {n}/{len(ids)} 已就位')


if __name__ == '__main__':
    main()
