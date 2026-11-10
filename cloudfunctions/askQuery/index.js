/**
 * askQuery：AI 问答（站内 RAG 精简版）
 * 链路：频控(3/分,20/天) → 站内检索(searchTokens/正则 top5) → 无候选不调模型（引导发帖）
 *      → 有候选调 CloudBase 免密钥大模型（hunyuan）生成回答 → 返回 answer+citations
 * 硬约束：只答站内、无引用不输出；P90 < 5s（检索轻量 + 生成限时）
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 25000 })
const db = cloud.database()
const _ = db.command
const { ok, fail, requireFields, rateLimit, charLen, CODE } = require('./lib')

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const min = 60 * 1000, hour = 60 * min, day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return Math.floor(diff / min) + ' 分钟前'
  if (diff < day) return Math.floor(diff / hour) + ' 小时前'
  if (diff < 30 * day) return Math.floor(diff / day) + ' 天前'
  const d = new Date(ts)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

exports.main = async (event) => {
  try {
    const { OPENID: uid } = cloud.getWXContext()
    requireFields(event, ['question'])
    const q = String(event.question).trim()
    if (charLen(q) < 2 || charLen(q) > 100) return fail(CODE.PARAM, '问题需 2~100 字')

    // 频控：每分钟 3 次、每天 20 次
    await rateLimit(db, uid, 'ask_1min', 3, 60)
    await rateLimit(db, uid, 'ask_1day', 20, 86400)

    // ---------- 站内检索 ----------
    const cands = await searchPosts(db, q, 5)

    // 无候选：不调模型，引导发帖
    if (!cands.length) {
      return ok({ answer: null, citations: [], guide: true })
    }

    // ---------- 免密钥大模型 ----------
    const context = cands.map((c, i) =>
      `[${i + 1}] 标题：${c.title}\n板块：${c.boardLabel}\n内容：${c.content.slice(0, 300)}`
    ).join('\n\n')

    const system = [
      '你是「好物分享」小程序的问答助手，服务对象是本校同学。',
      '规则：',
      '1. 只依据下面提供的站内分享内容回答，禁止编造站内不存在的信息；',
      '2. 回答里用 [1][2] 标注引用了哪条分享；',
      '3. 如果站内内容不足以回答，就说明站内暂时没有足够信息，建议同学自己发一条分享；',
      '4. 语气亲切可爱，用中文，控制在 200 字以内。'
    ].join('\n')

    let answer = ''
    try {
      // 云函数端大模型 API：wx-server-sdk ≥4.0.1 的 cloud.ai()（cloud.extend.AI 是小程序端 API，服务端不存在）
      const ai = cloud.ai()
      const model = ai.createModel('hunyuan-exp')
      const res = await model.generateText({
        model: 'hy3-preview',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `站内分享：\n${context}\n\n同学的问题：${q}` }
        ]
      })
      // 云函数端返回原始模型响应：res.choices[0].message.content（非 JS SDK 的 res.text）
      answer = (res && res.text)
        || (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content)
        || ''
    } catch (e) {
      console.error('[askQuery] model fail', e && e.message ? e.message : e)
      return fail(CODE.SERVER, 'AI 开小差了，请再问一次')
    }
    if (!answer) return fail(CODE.SERVER, 'AI 开小差了，请再问一次')

    // 引用帖封面
    const coverIds = [...new Set(cands.map(c => c.coverFileId).filter(Boolean))]
    let coverMap = {}
    if (coverIds.length) {
      const t = await cloud.getTempFileURL({ fileList: coverIds })
      for (const f of t.fileList || []) coverMap[f.fileID] = f.tempFileURL || ''
    }

    return ok({
      answer,
      citations: cands.map(c => ({
        id: c.id,
        title: c.title,
        board: c.board,
        cover: coverMap[c.coverFileId] || '',
        timeText: timeAgo(c.createdAt)
      }))
    })
  } catch (e) {
    console.error('[askQuery]', e)
    return e && e.code ? fail(e.code, e.msg, e.data) : fail(CODE.SERVER, '服务开小差了')
  }
}

/** 站内检索：2-gram 命中计数排序（MVP 用 token 检索替代向量，P90 可控） */
async function searchPosts(db, q, limit) {
  const BOARD_LABEL = { life: '生活', study: '学习', food: '美食' }
  const t = q.replace(/\s+/g, '')
  const grams = new Set()
  for (let i = 0; i < t.length - 1; i++) grams.add(t.slice(i, i + 2))
  const keys = [...grams].slice(0, 12)
  if (!keys.length) return []

  const res = await db.collection('posts')
    .where({ status: 'published', searchTokens: _.in(keys) })
    .limit(50)
    .get()
  // 计分：token 命中数 + 标题命中加成；再做相关性阈值过滤，
  // 避免长问题里常见 2-gram 误命中一堆无关帖（「问答不匹配」）
  const scored = res.data.map(p => {
    const hay = (p.title + p.content).toLowerCase()
    let score = 0
    for (const g of keys) if (hay.includes(g)) score++
    if ((p.title || '').toLowerCase().includes(t)) score += 3
    return { p, score }
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  const max = scored.length ? scored[0].score : 0
  const minScore = Math.max(2, Math.ceil(max * 0.35))
  return scored.filter(x => x.score >= minScore)
    .slice(0, limit)
    .map(({ p }) => ({
    id: p._id,
    title: p.title,
    board: p.board,
    boardLabel: BOARD_LABEL[p.board] || p.board,
    content: p.content,
    coverFileId: p.media && p.media[0] ? (p.media[0].type === 'image' ? p.media[0].fileId : p.media[0].posterFileId) : ''
  }))
}
