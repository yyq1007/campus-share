/**
 * meMessageRead（9.15）
 * 支持单条置读与全部置读（单次最多 100 条循环，避免一次 update 超限）
 */
const { coll, _, COL } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const msg = require('./lib/msg');

const BATCH = 100;
const MAX_ROUNDS = 20;

// 与 meList 的分类口径保持一致
const MSG_TYPES = {
  comment: ['comment', 'reply', 'expiry'],
  social: ['like', 'fav'],
};

/** 各 Tab 未读数（前端角标用），与 meList.listMessages 同口径 */
async function counts(uid) {
  const out = { all: 0, comment: 0, social: 0 };
  try {
    const [all, comment, social] = await Promise.all([
      coll(COL.messages).where({ toUid: uid, read: false }).count(),
      coll(COL.messages).where({ toUid: uid, read: false, type: _.in(MSG_TYPES.comment) }).count(),
      coll(COL.messages).where({ toUid: uid, read: false, type: _.in(MSG_TYPES.social) }).count(),
    ]);
    out.all = all.total || 0;
    out.comment = comment.total || 0;
    out.social = social.total || 0;
  } catch (e) { /* 计数失败不阻断 */ }
  return out;
}

exports.main = withAuth(async (event, ctx) => {
  const id = String(event.id || '').trim();

  if (!event.all && !id) return fail(40001, '缺少消息 ID');

  if (id && !event.all) {
    try {
      const r = await coll(COL.messages).doc(id).get();
      if (!r.data) return fail(40401);
      if (r.data.toUid !== ctx.uid) return fail(40301);
      await coll(COL.messages).doc(id).update({ data: { read: true } });
    } catch (e) {
      if (e && e.message && /not exist|不存在/i.test(e.message)) return fail(40401);
      return fail(50001);
    }
    // 单条置读后也返回分类未读数：前端角标要跟着更新，不能只更新总数
    return ok({ unread: await msg.unreadCount(ctx.uid), counts: await counts(ctx.uid) });
  }

  // 全部置读：只更新未读，分批处理
  for (let i = 0; i < MAX_ROUNDS; i += 1) {
    let rows = [];
    try {
      const res = await coll(COL.messages)
        .where({ toUid: ctx.uid, read: false })
        .field({ _id: true })
        .limit(BATCH)
        .get();
      rows = res.data || [];
    } catch (e) {
      return fail(50001);
    }
    if (!rows.length) break;
    try {
      await coll(COL.messages)
        .where({ _id: _.in(rows.map((r) => r._id)) })
        .update({ data: { read: true } });
    } catch (e) {
      return fail(50001);
    }
    if (rows.length < BATCH) break;
  }

  return ok({ unread: await msg.unreadCount(ctx.uid), counts: await counts(ctx.uid) });
}, { write: false });
