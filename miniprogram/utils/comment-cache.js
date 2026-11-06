/**
 * 详情页评论的内存缓存：退出重进时先显示缓存，再用服务端数据刷新
 * pending 记录发送中/刚发出的评论，云函数还没返回时就退出重进也能看到
 * 缓存跟随小程序进程，完全退出小程序后失效
 */
const { commentAvatarIndex } = require('./format')

const MAX_POSTS = 20
// 服务端读到的数据可能略滞后，发送成功 5 秒内的评论继续保留，靠 id 去重
const SETTLE_MS = 5000

function store() {
  const g = getApp().globalData
  if (!g.commentCache) g.commentCache = {}
  return g.commentCache
}

function prune(all) {
  const ids = Object.keys(all)
  if (ids.length <= MAX_POSTS) return
  ids
    .filter(id => !all[id].page && !all[id].pending.length)
    .sort((a, b) => all[a].at - all[b].at)
    .slice(0, ids.length - MAX_POSTS)
    .forEach(id => { delete all[id] })
}

function entryOf(postId) {
  const all = store()
  if (!all[postId]) {
    all[postId] = { list: [], cursor: null, hasMore: false, total: 0, loaded: false, pending: [], page: null, seq: 0, at: 0 }
    prune(all)
  }
  all[postId].at = Date.now()
  return all[postId]
}

/** 写入一页服务端数据；刷新第一页时清掉已确认落库的 pending */
function applyPage(entry, page, res, reset, startedAt) {
  entry.list = reset ? page : entry.list.concat(page)
  entry.cursor = res.nextCursor || null
  entry.hasMore = !!res.hasMore
  entry.total = res.total || entry.list.length
  entry.loaded = true
  if (reset) {
    entry.pending = entry.pending.filter(p => !(p.confirmedAt && p.confirmedAt < startedAt - SETTLE_MS))
  }
}

function toItem(p) {
  return {
    id: p.id || p.localId,
    floor: p.floor,
    avatarIdx: commentAvatarIndex(p.floor),
    content: p.content,
    createdAt: p.createdAt,
    status: p.status,
    replyToFloor: p.replyToFloor || 0,
    replyCount: 0,
    replies: [],
    mine: true,
    tag: p.tag || '',
    sending: !p.id,
    timeText: p.id ? '刚刚' : '发送中'
  }
}

/** 服务端里已有这条：有 id 按 id 比；还在发送中按「我发的 + 内容相同」比 */
function sameComment(p, item) {
  return p.id ? item.id === p.id : (!!item.mine && item.content === p.content)
}

/** 合并服务端列表和 pending，返回展示用列表及额外计入总数的条数 */
function merged(entry) {
  const comments = entry.list.slice()
  let extra = 0
  entry.pending.forEach(p => {
    if (!p.parentId) {
      if (comments.some(c => sameComment(p, c))) return
      comments.unshift(toItem(p))
      extra += 1
      return
    }
    const idx = comments.findIndex(c => c.id === p.parentId)
    if (idx < 0) return
    const parent = comments[idx]
    const replies = parent.replies || []
    if (replies.some(r => sameComment(p, r))) return
    comments[idx] = { ...parent, replies: replies.concat([toItem(p)]), replyCount: (parent.replyCount || 0) + 1 }
    extra += 1
  })
  return { comments, extra }
}

module.exports = { entryOf, applyPage, merged }
