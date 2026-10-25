/**
 * postCreate（9.6）
 * 校验 → 幂等 → 频控 → 媒体状态 → L1 敏感词 → msgSecCheck → 落库 → 异步结构化
 * 命中 reject 级敏感词：40010 + ranges，不落库、不回显词条
 */
const { coll, _, COL, db, shortId, charLen, normalizeText, excerpt, linkHost, isValidLink } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth, audit } = require('./lib/auth');
const { getConfig } = require('./lib/config');
const rate = require('./lib/rate');
const lex = require('./lib/lex');
const { msgSecCheck } = require('./lib/wxapi');
const { verifyMedia, incRef } = require('./lib/mediahelper');
const { tokenize } = require('./lib/tokenize');
const { hotScore } = require('./lib/hot');

const BOARDS = ['life', 'study', 'food'];
const FIELD_KEYS = ['shop', 'price', 'location', 'course', 'teacher', 'material'];

exports.main = withAuth(async (event, ctx) => {
  const config = await getConfig();
  const limits = config.limits || {};
  const board = String(event.board || '');
  const title = normalizeText(event.title || '').slice(0, 60);
  const content = normalizeText(event.content || '');
  const media = Array.isArray(event.media) ? event.media : [];
  const fields = event.fields && typeof event.fields === 'object' ? event.fields : {};
  const clientReqId = String(event.clientReqId || '');
  const editPostId = String(event.editPostId || '');

  if (BOARDS.indexOf(board) === -1) return fail(40001, '板块不合法');
  const cLen = charLen(content);
  if (cLen < 5) return fail(40001, '正文至少 5 个字');
  if (cLen > 2000) return fail(40002);
  if (charLen(title) > 40) return fail(40002, '标题最多 40 字');
  if (!clientReqId) return fail(40001, '缺少幂等键');

  // 媒体：数量与互斥
  const images = media.filter((m) => m && m.type === 'image');
  const videos = media.filter((m) => m && m.type === 'video');
  if (images.length > (limits.maxImages || 6)) return fail(40001, '图片最多 6 张');
  if (videos.length > 1) return fail(40001, '视频最多 1 个');
  if (images.length && videos.length) return fail(40001, '图片与视频不能同时发布');

  // 字段与链接
  const cleanFields = {};
  FIELD_KEYS.forEach((k) => {
    const v = String(fields[k] || '').trim();
    if (v) cleanFields[k] = v.slice(0, 60);
  });
  const link = String(fields.link || '').trim();
  if (link) {
    if (!isValidLink(link)) return fail(40001, '链接格式不正确');
    cleanFields.link = link;
    cleanFields.linkHost = linkHost(link);
  }

  // 幂等：同一 clientReqId 直接返回已有结果
  try {
    const dup = await coll(COL.posts).where({ clientReqId, authorUid: ctx.uid }).limit(1).get();
    if (dup.data && dup.data.length) {
      const p = dup.data[0];
      return ok({ postId: p._id, shortId: p.shortId, status: p.status, riskLevel: (p.risk && p.risk.level) || 'pass', duplicated: true });
    }
  } catch (e) { /* 索引缺失时忽略 */ }

  // 频控：10 分钟 3 条
  const rl = await rate.hit(ctx.uid, 'postCreate', limits.postPer10min || 3, 10 * 60 * 1000);
  if (!rl.allowed) return fail(42901, `发帖太频繁，${Math.ceil((10 * 60 * 1000) / 60000)} 分钟内最多 ${rl.limit} 条`);

  // 媒体归属与状态（不信任前端）
  const cleanMedia = [];
  let hasReviewMedia = false;
  for (const m of media) {
    if (!m || !m.fileId) continue;
    if (m.type !== 'image' && m.type !== 'video') continue;
    const v = await verifyMedia(m.fileId, ctx.uid);
    if (!v.ok && v.reason === 'RISKY') return fail(40003, '有图片未通过内容安全检测');
    if (!v.ok) return fail(40001, '图片信息无效');
    if (v.status === 'review' || v.status === 'pending') hasReviewMedia = true;
    if (m.type === 'video') hasReviewMedia = true; // 视频一律人工复审（11.4）
    cleanMedia.push({
      type: m.type,
      fileId: m.fileId,
      checkFileId: String(m.checkFileId || ''),
      posterFileId: String(m.posterFileId || ''),
      w: Number(m.w) || 0,
      h: Number(m.h) || 0,
      duration: Number(m.duration) || 0,
      size: Number(m.size) || 0,
      mime: String(m.mime || ''),
      checkStatus: v.status === 'unknown' ? 'pass' : v.status,
    });
  }

  // L1 本地敏感词
  const lexRes = await lex.check(`${title}\n${content}`);
  if (lexRes.reject) {
    await audit(ctx.uid, 'lexicon_block', 'post', '', { status: 'none' }, { status: 'rejected' }, lexRes.categories.join(','));
    return fail(40010, undefined, { ranges: lexRes.ranges, categories: lexRes.categories });
  }

  // L2 微信内容安全
  const wxRes = await msgSecCheck(`${title}\n${content}`, ctx.openid);
  const needReview = wxRes.suggest !== 'pass' || lexRes.review || hasReviewMedia;
  const status = needReview ? 'pending' : 'published';

  const now = new Date();
  const payload = {
    board,
    title,
    content,
    excerpt: excerpt(content, 60),
    media: cleanMedia,
    coverFileId: cleanMedia.length ? (cleanMedia[0].posterFileId || cleanMedia[0].fileId) : '',
    fields: cleanFields,
    status,
    risk: {
      level: needReview ? 'review' : 'pass',
      source: wxRes.degraded ? 'local' : 'wx',
      labels: lexRes.categories,
      checkedAt: now,
    },
    clientReqId,
    updatedAt: db.serverDate(),
  };

  // 编辑本人帖子
  if (editPostId) {
    let old = null;
    try {
      const r = await coll(COL.posts).doc(editPostId).get();
      old = r.data;
    } catch (e) {
      return fail(40401);
    }
    if (!old || old.authorUid !== ctx.uid) return fail(40301);

    (old.media || []).forEach((m) => incRef(m.fileId, -1));
    cleanMedia.forEach((m) => incRef(m.fileId, 1));

    await coll(COL.posts).doc(editPostId).update({
      data: Object.assign({}, payload, {
        searchTokens: tokenize(`${title} ${content} ${Object.values(cleanFields).join(' ')}`),
        publishedAt: status === 'published' ? now : old.publishedAt,
        rejectReason: '',
        hideReason: '',
      }),
    });
    return ok({ postId: editPostId, shortId: old.shortId, status, riskLevel: payload.risk.level });
  }

  const doc = Object.assign({}, payload, {
    shortId: shortId(),
    authorUid: ctx.uid,
    tags: [],
    aiSummary: '',
    searchTokens: tokenize(`${title} ${content} ${Object.values(cleanFields).join(' ')}`),
    stats: { likeCount: 0, favCount: 0, commentCount: 0, citedCount: 0, viewCount: 0 },
    commentSeq: 0,
    hotScore: hotScore({}, now, now.getTime()),
    publishedAt: status === 'published' ? now : null,
    createdAt: db.serverDate(),
    aiStructured: false,
  });

  const add = await coll(COL.posts).add({ data: doc });
  const postId = add._id;

  cleanMedia.forEach((m) => incRef(m.fileId, 1));

  // 待审入队
  if (status === 'pending') {
    try {
      await coll(COL.reviewQueue).add({
        data: {
          targetType: 'post',
          targetId: postId,
          source: hasReviewMedia ? (videos.length ? 'video' : 'wx') : (wxRes.suggest !== 'pass' ? 'wx' : 'ai'),
          aiLabel: '待人工判定',
          reason: needReview ? '内容安全待复核' : '',
          priority: 5,
          status: 'pending',
          createdAt: db.serverDate(),
        },
      });
    } catch (e) { /* 队列失败不阻断 */ }
  }

  // 作者统计 +1 + 触发结构化：必须 await，SCF 返回后容器冻结，未 await 的调用可能丢失
  const { cloud } = require('./lib/db');
  await Promise.all([
    coll(COL.users).where({ _id: ctx.uid }).update({ data: { 'stats.posts': _.inc(1) } }).catch((e) => {
      console.error('[postCreate] stats update failed', e && (e.errMsg || e.message));
    }),
    Promise.race([
      cloud.callFunction({ name: 'aiStructure', data: { postId } }),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]).catch(() => {}),
  ]);

  return ok({ postId, shortId: doc.shortId, status, riskLevel: payload.risk.level });
}, { write: true });
