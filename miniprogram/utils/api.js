/**
 * API 适配层 —— 唯一对接云函数契约的地方
 *
 * 契约来源：MVP产品开发文档-v1.0.md 第 9 章 + 线上环境部署版
 * 页面只调用本文件的语义化方法，不直接关心函数名与字段嵌套。
 *
 * 关键适配点：
 *  - postDetail 的计数在 post.stats.*，liked/faved 在 myInteraction
 *  - commentList 只返回一级评论（内嵌 ≤3 条回复），无 withReplies 参数
 *  - commentCreate 出参无 comment 对象，需自行构造
 *  - meList 统一入口（type: posts|favorites|messages）
 *  - meOverview 取代 profileGet，avatar 是 {fileId,status} 对象
 */
const { callFn } = require('./cloud')
const { getTempUrls } = require('./media')
const { BOARDS } = require('./config')

/**
 * 环境契约里 cover 是云存储 fileID，页面需要 https 临时链接才能渲染。
 * 同时补上板块中文名（postBrief 不含 boardLabel）。
 */
async function decorateBriefs(list) {
  const rows = list || []
  const ids = rows.map(p => p.cover).filter(id => id && String(id).startsWith('cloud://'))
  let map = {}
  if (ids.length) {
    try { map = await getTempUrls(ids) } catch (e) { map = {} }
  }
  return rows.map(p => {
    const b = BOARDS[p.board] || {}
    return {
      ...p,
      cover: p.cover && String(p.cover).startsWith('cloud://') ? (map[p.cover] || '') : (p.cover || ''),
      boardLabel: b.label || p.board || ''
    }
  })
}

// ---------- 身份 ----------

/** 无感登录：返回 { uid, role, status, needInvite, stats, unread, ... } */
function login() {
  return callFn('authLogin', {}, { timeout: 8000 })
}

/** 绑定邀请码：入参 code（6-16 位，大小写不敏感，服务端大写归一匹配） */
function bindInvite(code) {
  return callFn('authBindInvite', { code }, { timeout: 8000 })
}

/** 我的页聚合：{ uid, nickname, avatar, stats:{posts,favs,cited}, unread, pendingCount } */
function meOverview() {
  return callFn('meOverview', {})
}

/** 更新头像：avatarFileId 传 null/'' 恢复默认 */
function updateAvatar(avatarFileId) {
  return callFn('meUpdateProfile', { avatarFileId }, { timeout: 20000 })
}

// ---------- 内容 ----------

/** 媒体送审（9.19）：上传后调用 → 服务端登记 mediaAssets 台账 + imgSecCheck 图片安全检测 */
function mediaCheck(params) {
  return callFn('mediaCheck', params, { timeout: 15000 })
}

/** 首页 / 板块信息流 */
async function postList(params = {}) {
  const res = await callFn('postList', params)
  return { ...res, list: await decorateBriefs(res.list) }
}

/** 帖子详情：把 stats.* 与 myInteraction 平铺成页面易用结构 */
async function postDetail(id) {
  const res = await callFn('postDetail', { id })
  const p = res.post || {}
  const stats = p.stats || {}
  const inter = res.myInteraction || {}
  return {
    ...p,
    likeCount: stats.likeCount || 0,
    favCount: stats.favCount || 0,
    commentCount: stats.commentCount || 0,
    citedCount: stats.citedCount || 0,
    viewCount: stats.viewCount || 0,
    liked: !!inter.liked,
    faved: !!inter.faved,
    isMine: !!res.isMine,
    commentTotal: res.commentTotal || 0
  }
}

/** 发布 */
function postCreate(params) {
  return callFn('postCreate', params, { timeout: 30000 })
}

/** 删除（软删） */
function postDelete(postId) {
  return callFn('postDelete', { postId })
}

/** 点赞 / 收藏切换 */
function interactionToggle(targetId, type) {
  return callFn('interactionToggle', { targetType: 'post', targetId, type })
}

/** 举报：reasonCode 取白名单值 */
function reportCreate(targetType, targetId, reasonCode, reasonText) {
  const payload = { targetType, targetId, reasonCode }
  if (reasonText) payload.reasonText = reasonText
  return callFn('reportCreate', payload)
}

// ---------- 评论 ----------

/**
 * 一级评论列表（每条内嵌最多 3 条二级回复）
 * @param {String} postId
 * @param {String} parentId 传则返回该评论下的全部回复（最多 50 条）
 * @param {String} cursor 一级评论翻页游标（上一页返回的 nextCursor）
 */
function commentList(postId, parentId, cursor) {
  const params = { postId, pageSize: parentId ? 50 : 20 }
  if (parentId) params.parentId = parentId
  if (cursor) params.cursor = cursor
  return callFn('commentList', params)
}

/**
 * 发评论
 * @param {Object} o { postId, content, parentId?, replyToFloor?, clientReqId }
 */
function commentCreate(o) {
  return callFn('commentCreate', o, { timeout: 20000 })
}

// ---------- 我的 ----------

/** 我的分享：tab 支持 all|pending（环境版不区分 published/rejected） */
async function myPosts(params = {}) {
  const res = await callFn('meList', { type: 'posts', pageSize: 10, ...params })
  return { ...res, list: await decorateBriefs(res.list) }
}

/** 我的收藏 */
async function myFavorites(params = {}) {
  const res = await callFn('meList', { type: 'favorites', pageSize: 10, ...params })
  return { ...res, list: await decorateBriefs(res.list) }
}

/** 站内消息：tab 支持 all|comment|social */
function messages(params = {}) {
  return callFn('meList', { type: 'messages', pageSize: 20, ...params })
}

/** 单条已读 */
function messageRead(id) {
  return callFn('meMessageRead', { id })
}

/** 全部已读 */
function messageReadAll() {
  return callFn('meMessageRead', { all: true })
}

// ---------- 审核台 ----------

/** 审核队列：tab = pending|report|done */
function adminQueue(params = {}) {
  return callFn('adminQueue', params)
}

/** 审核处理：action = approve|reject|hide|ignore|banUser */
function adminReview(queueId, action, reason) {
  const payload = { queueId, action }
  if (reason) payload.reason = reason
  return callFn('adminReview', payload)
}

// ---------- AI 问答 ----------

/** 问答：{ question, history?, clientReqId } */
function askQuery(question, history, clientReqId) {
  return callFn('askQuery', { question, history, clientReqId }, { timeout: 20000 })
}

module.exports = {
  login, bindInvite, meOverview, updateAvatar,
  postList, postDetail, postCreate, postDelete, interactionToggle, reportCreate,
  commentList, commentCreate,
  myPosts, myFavorites, messages, messageRead, messageReadAll,
  adminQueue, adminReview,
  askQuery
}
