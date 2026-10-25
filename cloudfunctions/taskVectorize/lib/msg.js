/** 站内消息（8.10 / C-17）：点赞收藏按「帖子 + 24h」合并 */
const { coll, _, COL, db, dayKey } = require('./db');

/**
 * @param {{toUid:string,type:string,title:string,body:string,refType?:string,refId?:string,dedupeKey?:string}} m
 */
async function push(m) {
  if (!m || !m.toUid) return null;
  const data = {
    toUid: m.toUid,
    type: m.type,
    title: m.title,
    body: m.body || '',
    refType: m.refType || 'post',
    refId: m.refId || '',
    count: 1,
    read: false,
    dedupeKey: m.dedupeKey || '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };

  if (m.dedupeKey) {
    try {
      const res = await coll(COL.messages).where({ dedupeKey: m.dedupeKey }).limit(1).get();
      if (res.data && res.data.length) {
        await coll(COL.messages).doc(res.data[0]._id).update({
          data: { count: _.inc(1), read: false, body: m.body, updatedAt: db.serverDate() },
        });
        return res.data[0]._id;
      }
    } catch (e) {
      // 继续走新增
    }
  }

  try {
    const res = await coll(COL.messages).add({ data });
    return res._id;
  } catch (e) {
    return null;
  }
}

function likeDedupeKey(postId) {
  return `like:${postId}:${dayKey()}`;
}

function favDedupeKey(postId) {
  return `fav:${postId}:${dayKey()}`;
}

async function unreadCount(uid) {
  try {
    const res = await coll(COL.messages).where({ toUid: uid, read: false }).count();
    return res.total || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = { push, likeDedupeKey, favDedupeKey, unreadCount };
