/** 出参整形：字段裁剪与脱敏（16.4） */
const { ms } = require('./db');

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
 */
function commentItem(c, replies, uid) {
  return {
    id: c._id,
    floor: c.floor,
    content: c.status === 'deleted' ? '该评论已删除' : c.content,
    createdAt: ms(c.createdAt),
    status: c.status === 'deleted' ? 'deleted' : c.status,
    isMine: !!uid && c.authorUid === uid,
    replyCount: c.replyCount || 0,
    replies: (replies || []).map((r) => ({
      id: r._id,
      floor: r.floor,
      replyToFloor: r.replyToFloor || 0,
      content: r.status === 'deleted' ? '该评论已删除' : r.content,
      createdAt: ms(r.createdAt),
      isMine: !!uid && r.authorUid === uid,
    })),
  };
}

module.exports = { postBrief, postFull, commentItem };
