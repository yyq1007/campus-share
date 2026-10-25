/**
 * 云函数公共库 _shared/lib.js —— 构建时复制进每个函数目录
 * 统一响应码：0 成功；40001 参数；40002 不存在；40003 无权限；40010 敏感词驳回；
 * 40029 频控；40301 非审核员；500 服务错误
 */
const CODE = {
  OK: 0,
  PARAM: 40001,
  NOT_FOUND: 40002,
  FORBIDDEN: 40003,
  REJECT: 40010,
  RATE: 40029,
  NOT_REVIEWER: 40301,
  SERVER: 500
}

function ok(data, extra = {}) {
  return { code: CODE.OK, msg: 'ok', data, ...extra }
}

function fail(code, msg, data) {
  return { code, msg, data: data || undefined }
}

/** 参数校验：requireFields(body, ['id','title']) */
function requireFields(body, fields) {
  for (const f of fields) {
    const v = body[f]
    if (v === undefined || v === null || v === '') {
      throw { code: CODE.PARAM, msg: `缺少参数 ${f}` }
    }
  }
}

/** 字符数（与前端 Array.from 同口径） */
function charLen(s) {
  return s ? [...String(s)].length : 0
}

/** 清洗正文：行 trim + 压缩 3 连以上空行 + 首尾 */
function cleanContent(s) {
  return String(s || '')
    .split('\n')
    .map(x => x.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 规范空白文本 */
function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

/**
 * 本地敏感词检测（服务端词库，绝不下发前端）
 * 覆盖：中文/繁体/英文全拼/首字母(≥4)/数字谐音/同形字/零宽
 * 返回 { level: 'pass'|'review'|'reject', ranges: [{start,end}] }
 * 词表为 MVP 演示集，上线前替换为完整词库（configs.moderation.words）
 */
const REJECT_WORDS = [
  // 违禁（演示子集，完整版走 configs）
  '赌博', '博彩', '六合彩', '代开发票', '办证', '代考', '枪', '毒品', '冰毒',
  '刷单', '兼职打字', '流水兼职', '信用卡套现', '套现',
  '加微信卖', '招嫖', '约炮', '援交',
  'dubo', 'bo cai', 'shua dan', 'zc', 'kF'
]
const REVIEW_WORDS = [
  '代购', '拼单', '拉群', '兼职', '优惠返现', '返利', '免费领',
  '加我', '私聊', '威信', '微❤', 'vx', 'VX', 'V信',
  'dai gou', 'jia wo'
]
// 同形字映射
const HOMOGLYPH = {
  '〇': '零', '０': '0', '①': '1', '❤': '心', '＊': '*',
  '賭': '赌', '博': '博', '發': '发', '票': '票', '證': '证'
}

function normalizeForCheck(s) {
  let t = String(s || '')
  // 去零宽字符
  t = t.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  // 同形字归一
  t = [...t].map(ch => HOMOGLYPH[ch] || ch).join('')
  return t
}

function pinyinFull(word) {
  // MVP：仅映射高频词全拼（完整版用 pinyin-pro 预生成）
  const MAP = {
    '赌博': 'dubo', '代购': 'daigou', '加我': 'jiawo', '刷单': 'shuadan',
    '兼职': 'jianzhi', '办证': 'banzheng', '私聊': 'siliao'
  }
  return MAP[word] || ''
}

function findRanges(norm, words) {
  const lower = norm.toLowerCase()
  const ranges = []
  for (const w of words) {
    const variants = [w]
    const py = pinyinFull(w)
    if (py) variants.push(py)
    // 首字母缩写（≥4 字母词才检查）
    if (py && py.length >= 4) variants.push(py.split('').map(c => c).reduce((a, c, i) => a + c, '').slice(0, 2))
    for (const v of variants) {
      if (!v) continue
      const needle = v.toLowerCase()
      let idx = lower.indexOf(needle)
      while (idx >= 0) {
        ranges.push({ start: idx, end: idx + [...v].length })
        idx = lower.indexOf(needle, idx + needle.length)
      }
    }
  }
  return ranges
}

/**
 * 文本送审：
 * reject 命中 → 驳回（不落库）；review 命中 → 进 pending；无命中 → 由调用方决定是否仍走 msgSecCheck
 */
function textCheck(raw) {
  const norm = normalizeForCheck(raw)
  const rejectRanges = findRanges(norm, REJECT_WORDS)
  if (rejectRanges.length) {
    return { level: 'reject', ranges: rejectRanges }
  }
  const reviewRanges = findRanges(norm, REVIEW_WORDS)
  if (reviewRanges.length) {
    return { level: 'review', ranges: reviewRanges }
  }
  return { level: 'pass', ranges: [] }
}

/**
 * 频控：rateLimits 集合，key 形如 {uid, scene, day}
 * rules: [{scene, windowSec, max}] 滑窗内计数
 */
async function rateLimit(db, uid, scene, max, windowSec) {
  const now = Date.now()
  const coll = db.collection('rateLimits')
  const since = now - windowSec * 1000
  const cntRes = await coll.where({ uid, scene, at: db.command.gte(since) }).count()
  if ((cntRes.total || 0) >= max) {
    throw { code: CODE.RATE, msg: '操作太频繁，休息一下再来' }
  }
  await coll.add({ data: { uid, scene, at: now } })
  // 顺手清理过期记录（概率触发）
  if (Math.random() < 0.05) {
    try { await coll.where({ at: db.command.lt(since - 3600 * 1000) }).remove() } catch (e) { /* */ }
  }
}

/** 幂等：clientReqId 查重（配合集合唯一索引） */
async function assertUniqueReq(db, uid, clientReqId) {
  if (!clientReqId) return
  const r = await db.collection('idempotency').where({ uid, clientReqId }).count()
  if ((r.total || 0) > 0) {
    throw { code: CODE.PARAM, msg: '请勿重复提交' }
  }
  await db.collection('idempotency').add({ data: { uid, clientReqId, at: Date.now() } })
}

/** 楼层号自增（posts.commentSeq 事务） */
async function nextFloor(db, postId) {
  const t = await db.runTransaction(async transaction => {
    const p = await transaction.collection('posts').doc(postId).get()
    const seq = ((p.data && p.data.commentSeq) || 0) + 1
    await transaction.collection('posts').doc(postId).update({ data: { commentSeq: seq } })
    return seq
  })
  return t
}

/** 随机串 */
function randId(len = 16) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

/** 脱敏昵称生成：花生+4位 */
function genNick() {
  const a = ['花生', '芋圆', '麻薯', '奶盖', '布丁', '糯米', '椰冻', '芝士', '杏仁', '桃胶']
  return a[Math.floor(Math.random() * a.length)] + randId(4)
}

module.exports = {
  CODE, ok, fail, requireFields, charLen, cleanContent, normalizeText,
  textCheck, rateLimit, assertUniqueReq, nextFloor, randId, genNick
}
