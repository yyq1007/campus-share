/** 出参整形：字段裁剪与脱敏（16.4） */
const { ms } = require('./db');

/**
 * 糖果色头像序号（1-5），按 floor 派生。
 * 与前端 utils/format.js 的 avatarIndex 同算法，但入参不同：
 *   前端用 uid（个人主页头像，按人取色是合理的）
 *   这里用 floor（评论头像，按楼层取色 → 不同评论不同色，不可关联作者）
 */
function avatarIndex(floor) {
  const n = Number(floor) || 0;
  if (!n) return 1;
  let h = 0;
  for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 5) + 1;
}

function postBrief(p, inter) {
  const media = p.media || [];
  const first = media[0] || {};
  const isVideo = first.type === 'video';
  const i = inter || {};
  return {
    id: p._id,
    shortId: p.shortId,
    board: p.board,
    title: p.title || '',
    excerpt: p.aiSummary || p.excerpt || '',
    cover: p.coverFileId || first.posterFileId || first.fileId || '',
    mediaType: isVideo ? 'video' : (media.length ? 'image' : ''),
    duration: first.duration || 0,
    likeCount: (p.stats && p.stats.likeCount) || 0,
    favCount: (p.stats && p.stats.favCount) || 0,
    commentCount: (p.stats && p.stats.commentCount) || 0,
    liked: !!i.liked,
    faved: !!i.faved,
    createdAt: ms(p.createdAt),
    publishedAt: ms(p.publishedAt),
    expired: !!p.expired,
    status: p.status,
  };
}

function postFull(p, isMine) {
  const stats = Object.assign({}, p.stats || {});
  if (!isMine) {
    delete stats.citedCount;
    delete stats.viewCount;
  }
  return {
    id: p._id,
    shortId: p.shortId,
    board: p.board,
    title: p.title || '',
    content: p.content,
    media: (p.media || []).map((m) => ({
      type: m.type,
      fileId: m.fileId,
      posterFileId: m.posterFileId || '',
      w: m.w || 0,
      h: m.h || 0,
      duration: m.duration || 0,
      size: m.size || 0,
      mime: m.mime || '',
      checkStatus: m.checkStatus || 'pass',
    })),
    coverFileId: p.coverFileId || '',
    fields: p.fields || {},
    tags: p.tags || [],
    aiSummary: p.aiSummary || '',
    status: p.status,
    risk: isMine ? p.risk : { level: p.risk ? p.risk.level : 'pass' },
    stats,
    createdAt: ms(p.createdAt),
    publishedAt: ms(p.publishedAt),
    expired: !!p.expired,
    rejectReason: isMine ? p.rejectReason || '' : '',
    hideReason: isMine ? p.hideReason || '' : '',
  };
}

/**
 * 评论出参（匿名化：不下发 authorUid）
 * 第二个参数为当前用户 uid，用于计算 isMine 标记
 *
 * ⚠️ avatarIdx 是「糖果色头像」的序号（1-5），按 floor 派生而非按作者派生：
 *   若按作者算，同一作者所有评论同色 → 等于用颜色重建作者画像，破坏匿名。
 *   按楼层号算则每个评论独立取色，视觉上照样有色彩变化，但不可关联。
 */
function commentItem(c, replies, uid) {
  return {
    id: c._id,
    floor: c.floor,
    avatarIdx: avatarIndex(c.floor),
    content: c.status === 'deleted' ? '该评论已删除' : c.content,
    createdAt: ms(c.createdAt),
    status: c.status === 'deleted' ? 'deleted' : c.status,
    isMine: !!uid && c.authorUid === uid,
    replyCount: c.replyCount || 0,
    replies: (replies || []).map((r) => ({
      id: r._id,
      floor: r.floor,
      avatarIdx: avatarIndex(r.floor),
      replyToFloor: r.replyToFloor || 0,
      content: r.status === 'deleted' ? '该评论已删除' : r.content,
      createdAt: ms(r.createdAt),
      isMine: !!uid && r.authorUid === uid,
    })),
  };
}

module.exports = { postBrief, postFull, commentItem };
