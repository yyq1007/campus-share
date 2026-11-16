/**
 * postList（9.4）
 * 强制 status=published；游标分页；不返回 authorUid/openid
 */
/* ===== MEM-INJECT: lib 模块内存注入（本机 CLI 打包丢 lib 目录的兜底，云端修复后可删） ===== */
;(function () {
  var __Module = require('module')
  var __path = require('path')
  var __FILES = {"auth.js": "/** 鉴权中间层（9.1 / 16.3）：OPENID → users → ctx */\nconst { cloud, coll, COL, db } = require('./db');\nconst { fail } = require('./resp');\n\nasync function resolveCtx(event, opts) {\n  const wxContext = cloud.getWXContext();\n  let openid = wxContext.OPENID || '';\n  // 仅用于云端自测（本地/控制台调用无 OPENID）；正式环境该变量为空\n  if (!openid && process.env.DEV_OPENID) openid = process.env.DEV_OPENID;\n  if (!openid) return { error: fail(40100) };\n\n  const res = await coll(COL.users).where({ openid }).limit(1).get();\n  if (!res.data.length) return { error: fail(40101) };\n  const user = res.data[0];\n\n  if (user.status === 'banned') return { error: fail(40302) };\n  if (opts && opts.write && (user.status === 'deactivating' || user.status === 'deleted')) {\n    return { error: fail(40302) };\n  }\n  if (opts && opts.write && user.status === 'muted') return { error: fail(40303) };\n\n  return {\n    ctx: {\n      uid: user._id,\n      role: user.role || 'user',\n      status: user.status,\n      credit: typeof user.credit === 'number' ? user.credit : 100,\n      user,\n      openid,\n    },\n  };\n}\n\nasync function audit(actorUid, action, targetType, targetId, before, after, reason) {\n  try {\n    await coll(COL.auditLogs).add({\n      data: {\n        actorUid: actorUid || '',\n        action,\n        targetType: targetType || '',\n        targetId: targetId || '',\n        before: before || {},\n        after: after || {},\n        reason: reason || '',\n        createdAt: db.serverDate(),\n      },\n    });\n  } catch (e) {\n    // 审计失败不阻断主流程\n  }\n}\n\n/**\n * @param {(event:object, ctx:object)=>Promise<any>} handler\n * @param {{write?:boolean, admin?:boolean}} opts\n */\nfunction withAuth(handler, opts = {}) {\n  return async function main(event) {\n    const r = await resolveCtx(event, opts);\n    if (r.error) return r.error;\n    if (opts.admin && r.ctx.role !== 'admin') {\n      await audit(r.ctx.uid, 'forbidden', 'function', event && event.$action, { status: 'user' }, { status: 'denied' }, 'admin_only');\n      return fail(40301);\n    }\n    try {\n      return await handler(event || {}, r.ctx);\n    } catch (e) {\n      console.error('[handler-error]', e && (e.stack || e.message || e));\n      return fail(50001);\n    }\n  };\n}\n\nmodule.exports = { resolveCtx, withAuth, audit };\n", "config.js": "/** 配置读取（configs/global），60s 进程内缓存 */\nconst { coll, COL } = require('./db');\n\nconst DEFAULTS = {\n  boards: {\n    life: { label: '生活', fields: ['shop', 'price', 'location'] },\n    study: { label: '学习', fields: ['course', 'teacher', 'material'] },\n    food: { label: '美食', fields: ['shop', 'price', 'location'] },\n  },\n  limits: {\n    postPer10min: 3,\n    commentPer10min: 10,\n    askPerDay: 10,\n    reportPerDay: 20,\n    qrcodePerDay: 5,\n    maxImages: 6,\n    maxImageMB: 1,\n    maxVideoMB: 30,\n    videoSeconds: 60,\n    avatarPerHour: 3,\n  },\n  hot: { like: 3, fav: 4, comment: 5, cite: 6, gravity: 1.5, expireDays: 90 },\n  ai: { model: 'local-rag', topK: 5, minScore: 0.18, dailyBudget: 500, enabled: false },\n  lexicon: { version: 'v1', rejectEnabled: true, strikeCooldownMin: 10, strikeThreshold: 3 },\n  flags: { allowVideo: true, allowAsk: true, maintenance: false },\n};\n\nlet cache = null;\nlet cacheAt = 0;\nconst TTL = 60 * 1000;\n\nfunction merge(base, extra) {\n  const out = Object.assign({}, base);\n  Object.keys(extra || {}).forEach((k) => {\n    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k]) {\n      out[k] = Object.assign({}, base[k], extra[k]);\n    } else if (extra[k] !== undefined) {\n      out[k] = extra[k];\n    }\n  });\n  return out;\n}\n\nasync function getConfig(force) {\n  const now = Date.now();\n  if (!force && cache && now - cacheAt < TTL) return cache;\n  let doc = null;\n  try {\n    const res = await coll(COL.configs).doc('global').get();\n    doc = res.data;\n  } catch (e) {\n    doc = null;\n  }\n  cache = merge(DEFAULTS, doc || {});\n  cacheAt = now;\n  return cache;\n}\n\nmodule.exports = { getConfig, DEFAULTS };\n", "db.js": "/** 数据库与通用工具 */\nconst cloud = require('wx-server-sdk');\n\ncloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });\n\nconst db = cloud.database();\nconst _ = db.command;\nconst $ = db.command.aggregate;\n\nconst COL = {\n  users: 'users',\n  posts: 'posts',\n  comments: 'comments',\n  interactions: 'interactions',\n  reports: 'reports',\n  qaLogs: 'qaLogs',\n  reviewQueue: 'reviewQueue',\n  vectors: 'vectors',\n  inviteCodes: 'inviteCodes',\n  messages: 'messages',\n  mediaAssets: 'mediaAssets',\n  auditLogs: 'auditLogs',\n  rateLimits: 'rateLimits',\n  configs: 'configs',\n  qrcodes: 'qrcodes',\n  sensitiveWords: 'sensitiveWords',\n};\n\nfunction coll(name) {\n  return db.collection(name);\n}\n\nconst BASE32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';\n\nfunction randomBase32(len) {\n  let s = '';\n  for (let i = 0; i < len; i += 1) s += BASE32[Math.floor(Math.random() * BASE32.length)];\n  return s;\n}\n\nfunction shortId() {\n  return randomBase32(6);\n}\n\nfunction charLen(str) {\n  return Array.from(String(str || '')).length;\n}\n\nfunction normalizeText(str) {\n  return String(str || '')\n    .replace(/[\\u3000]/g, ' ')\n    .replace(/[ \\t]+/g, ' ')\n    .split('\\n')\n    .map((l) => l.trim())\n    .join('\\n')\n    .trim();\n}\n\nfunction excerpt(text, len = 60) {\n  const t = String(text || '').replace(/\\s+/g, ' ').trim();\n  const arr = Array.from(t);\n  return arr.length > len ? `${arr.slice(0, len).join('')}…` : t;\n}\n\nfunction linkHost(url) {\n  const m = String(url || '').match(/^https?:\\/\\/([^/?#]+)/i);\n  return m ? m[1] : '';\n}\n\nfunction isValidLink(url) {\n  const s = String(url || '').trim();\n  if (!s) return true;\n  if (s.length > 200) return false;\n  if (/\\s/.test(s)) return false;\n  if (!/^https?:\\/\\//i.test(s)) return false;\n  if (/^(javascript|data|vbscript):/i.test(s)) return false;\n  return true;\n}\n\nfunction ms(date) {\n  if (!date) return 0;\n  if (date instanceof Date) return date.getTime();\n  if (typeof date === 'number') return date;\n  const t = new Date(date).getTime();\n  return Number.isNaN(t) ? 0 : t;\n}\n\nfunction dayKey(d) {\n  const dt = d ? new Date(d) : new Date();\n  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;\n}\n\n/** 分页游标编解码（9.4） */\nfunction encodeCursor(obj) {\n  if (!obj) return null;\n  return Buffer.from(JSON.stringify(obj)).toString('base64');\n}\n\nfunction decodeCursor(str) {\n  if (!str) return null;\n  try {\n    return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));\n  } catch (e) {\n    return null;\n  }\n}\n\n/**\n * 批量更新（分批执行，绕开单次 100 条上限）\n *\n * ⚠️ 云开发里 where().update() 单次最多影响约 100 条。\n * 直接调用时，超出部分不会被更新 —— 表现为「封禁了但老帖子还公开可见」。\n *\n * 做法（不依赖「更新字段出现在 where 条件里」这种脆弱前提）：\n *   1. 按 where 扫出 _id（分页，每页 scanLimit 条）\n *   2. 每 100 个 id 一组，用 where({_id: _.in(ids)}) 执行 update\n *   3. 翻页直到扫完或达到 maxRounds\n *\n * @param {string} colName 集合名\n * @param {object} where 查询条件\n * @param {object} data 更新字段\n * @param {object} [opts] { batchSize=100, scanLimit=500, maxRounds=40 }\n * @returns {Promise<number>} 实际更新条数\n */\nasync function batchUpdate(colName, where, data, opts = {}) {\n  const batchSize = opts.batchSize || 100;\n  const scanLimit = opts.scanLimit || 500;\n  const maxRounds = opts.maxRounds || 40;\n  let total = 0;\n  let scanned = 0;\n\n  for (let round = 0; round < maxRounds; round += 1) {\n    // eslint-disable-next-line no-await-in-loop\n    const res = await coll(colName)\n      .where(where)\n      .field({ _id: true })\n      .skip(scanned)\n      .limit(scanLimit)\n      .get();\n    const ids = (res.data || []).map((r) => r._id);\n    if (!ids.length) break;\n    scanned += ids.length;\n\n    for (let i = 0; i < ids.length; i += batchSize) {\n      const chunk = ids.slice(i, i + batchSize);\n      // eslint-disable-next-line no-await-in-loop\n      const r = await coll(colName).where({ _id: _.in(chunk) }).update({ data });\n      total += (r && r.stats && r.stats.updated) || 0;\n    }\n\n    if (ids.length < scanLimit) break; // 扫完了\n  }\n\n  if (scanned >= scanLimit * maxRounds) {\n    console.warn('[batchUpdate] 达到最大扫描轮次，可能仍有未处理数据:', colName, JSON.stringify(where));\n  }\n  return total;\n}\n\nmodule.exports = {\n  cloud,\n  db,\n  _,\n  $,\n  COL,\n  coll,\n  shortId,\n  randomBase32,\n  charLen,\n  normalizeText,\n  excerpt,\n  linkHost,\n  isValidLink,\n  ms,\n  dayKey,\n  encodeCursor,\n  decodeCursor,\n  batchUpdate,\n};\n", "embed.js": "/**\n * 本地向量化（9.20 / 9.21 的降级实现）\n * 未接入大模型向量接口时，用「2-gram 词袋 + 特征哈希 + L2 归一化」得到 768 维向量。\n * 优点：零依赖、确定性、冷启动快；与余弦检索配合后对站内短文本召回足够。\n * 换用真实 embedding 模型时，只要保持 DIM 一致，写入/检索代码无需改动。\n */\nconst { tokenize } = require('./tokenize');\n\nconst DIM = 768;\nconst MODEL = 'local-hash-768';\n\nfunction hash32(str) {\n  let h = 2166136261;\n  for (let i = 0; i < str.length; i += 1) {\n    h ^= str.charCodeAt(i);\n    h = Math.imul(h, 16777619);\n  }\n  return h >>> 0;\n}\n\nfunction embed(text) {\n  const v = new Float64Array(DIM);\n  const toks = tokenize(String(text || '').slice(0, 1000), 400);\n  toks.forEach((t) => {\n    const h = hash32(t);\n    const idx = h % DIM;\n    const sign = (h >>> 15) & 1 ? -1 : 1;\n    // 长词权重略高，抑制高频单字噪声\n    v[idx] += sign * (t.length > 1 ? 1.2 : 0.8);\n  });\n  let norm = 0;\n  for (let i = 0; i < DIM; i += 1) norm += v[i] * v[i];\n  norm = Math.sqrt(norm);\n  const out = new Array(DIM);\n  for (let i = 0; i < DIM; i += 1) out[i] = norm > 0 ? v[i] / norm : 0;\n  return out;\n}\n\n/** 两枚已归一化向量的余弦相似度 */\nfunction cosine(a, b) {\n  if (!a || !b) return 0;\n  const n = Math.min(a.length, b.length);\n  let s = 0;\n  for (let i = 0; i < n; i += 1) s += a[i] * b[i];\n  return s;\n}\n\nfunction textHash(text) {\n  return hash32(String(text || '').slice(0, 1000)).toString(16);\n}\n\nmodule.exports = { embed, cosine, textHash, DIM, MODEL };\n", "hot.js": "/** 热度分（9.22）：加权互动 / 时间衰减；含 1 的基座分避免零互动新帖沉底 */\nconst { ms } = require('./db');\n\nfunction hotScore(stats, publishedAt, now) {\n  const s = stats || {};\n  const w = 3 * (s.likeCount || 0) + 4 * (s.favCount || 0) + 5 * (s.commentCount || 0) + 6 * (s.citedCount || 0);\n  const hours = Math.max(0, ((now || Date.now()) - ms(publishedAt)) / 3600000);\n  return Number(((w + 1) / Math.pow(hours + 2, 1.5)).toFixed(4));\n}\n\nmodule.exports = { hotScore };\n", "lex.js": "/**\n * L1 本地敏感词过滤（15.3 / 15.4）\n * - 归一并保持长度不变（NFKC 常见范围 / 全角→半角 / 大小写 / 零宽字符）\n * - AC 自动机多模式匹配\n * - reject 命中 → 直接驳回，只回传位置区间，不回传词条\n * - 无词库时使用内置兜底词条\n */\nconst { coll, COL } = require('./db');\n\nconst FALLBACK_TERMS = [\n  { term: '收黑钱', level: 'reject', category: 'accuse' },\n  { term: '地沟油', level: 'reject', category: 'accuse' },\n  { term: '吃回扣', level: 'reject', category: 'accuse' },\n  { term: '走后门', level: 'review', category: 'accuse' },\n  { term: '内定', level: 'review', category: 'accuse' },\n  { term: '黑幕', level: 'review', category: 'accuse' },\n  { term: '骗钱', level: 'reject', category: 'accuse' },\n  { term: '贪污', level: 'reject', category: 'accuse' },\n  { term: '傻逼', level: 'reject', category: 'abuse' },\n  { term: '沙比', level: 'reject', category: 'abuse' },\n  { term: '煞笔', level: 'reject', category: 'abuse' },\n  { term: '脑残', level: 'reject', category: 'abuse' },\n  { term: '智障', level: 'reject', category: 'abuse' },\n  { term: '贱人', level: 'reject', category: 'abuse' },\n  { term: '去死', level: 'reject', category: 'abuse' },\n  { term: '狗东西', level: 'reject', category: 'abuse' },\n  { term: '代购', level: 'review', category: 'ad' },\n  { term: '刷单', level: 'reject', category: 'ad' },\n  { term: '加微信', level: 'review', category: 'contact' },\n  { term: '私聊我', level: 'review', category: 'ad' },\n  { term: '一手货源', level: 'reject', category: 'ad' },\n  { term: '招代理', level: 'reject', category: 'ad' },\n  { term: '兼职日结', level: 'reject', category: 'ad' },\n  { term: '扫码进群', level: 'review', category: 'ad' },\n  { term: '淘口令', level: 'review', category: 'ad' },\n  { term: '约炮', level: 'reject', category: 'porn' },\n  { term: '裸聊', level: 'reject', category: 'porn' },\n  { term: '赌博', level: 'reject', category: 'other' },\n  { term: '博彩', level: 'reject', category: 'other' },\n  { term: '枪支', level: 'reject', category: 'violence' },\n  { term: '毒品', level: 'reject', category: 'violence' },\n];\n\nconst REGEX_RULES = [\n  { re: /(?:\\+?86[-\\s]?)?1[3-9]\\d{9}/g, level: 'review', category: 'contact' },\n  { re: /(?:qq|扣扣)\\s*[:：]?\\s*\\d{5,11}/gi, level: 'review', category: 'contact' },\n  { re: /(?:加|➕|\\+)\\s*(?:v|V|微|威信|微信|wx|WX)\\s*[:：]?\\s*[a-zA-Z][-_a-zA-Z0-9]{5,19}/g, level: 'review', category: 'contact' },\n];\n\nfunction normalizeChar(ch) {\n  const code = ch.charCodeAt(0);\n  // 零宽 / BOM\n  if ((code >= 0x200b && code <= 0x200f) || code === 0xfeff) return ' ';\n  // 全角 ASCII\n  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0).toLowerCase();\n  if (code === 0x3000) return ' ';\n  return ch.toLowerCase();\n}\n\nfunction normalize(str) {\n  const chars = Array.from(String(str || ''));\n  return chars.map(normalizeChar);\n}\n\n/** AC 自动机 */\nfunction buildMachine(terms) {\n  const root = { next: Object.create(null), fail: null, out: [] };\n  terms.forEach((t) => {\n    const chars = normalize(t.term);\n    if (!chars.length) return;\n    let node = root;\n    chars.forEach((c) => {\n      if (!node.next[c]) node.next[c] = { next: Object.create(null), fail: null, out: [] };\n      node = node.next[c];\n    });\n    node.out.push({ level: t.level, category: t.category, len: chars.length });\n  });\n\n  // BFS 构建失败指针\n  const queue = [];\n  Object.keys(root.next).forEach((k) => {\n    root.next[k].fail = root;\n    queue.push(root.next[k]);\n  });\n  while (queue.length) {\n    const node = queue.shift();\n    Object.keys(node.next).forEach((k) => {\n      const child = node.next[k];\n      let f = node.fail;\n      while (f && !f.next[k]) f = f.fail;\n      child.fail = f && f.next[k] ? f.next[k] : root;\n      child.out = child.out.concat(child.fail.out);\n      queue.push(child);\n    });\n  }\n  return root;\n}\n\nlet cached = null;\nlet cachedAt = 0;\nconst TTL = 5 * 60 * 1000;\n\nasync function loadTerms() {\n  const now = Date.now();\n  if (cached && now - cachedAt < TTL) return cached;\n  let terms = [];\n  try {\n    const res = await coll(COL.sensitiveWords).where({ enabled: true }).limit(1000).get();\n    terms = (res.data || [])\n      .filter((d) => d.term && d.type !== 'regex' && d.level !== 'allow')\n      .map((d) => ({ term: d.term, level: d.level || 'review', category: d.category || 'other' }));\n  } catch (e) {\n    terms = [];\n  }\n  if (!terms.length) terms = FALLBACK_TERMS;\n  cached = { machine: buildMachine(terms), size: terms.length };\n  cachedAt = now;\n  return cached;\n}\n\n/**\n * @returns {Promise<{reject:boolean, review:boolean, ranges:number[][], categories:string[]}>}\n */\nasync function check(text, options = {}) {\n  const { machine } = await loadTerms();\n  const chars = normalize(text);\n  const ranges = [];\n  const categories = new Set();\n  let reject = false;\n  let review = false;\n\n  let node = machine;\n  for (let i = 0; i < chars.length; i += 1) {\n    const c = chars[i];\n    while (node && !node.next[c]) node = node.fail;\n    node = node && node.next[c] ? node.next[c] : machine;\n    if (node.out && node.out.length) {\n      node.out.forEach((o) => {\n        const start = i - o.len + 1;\n        if (start < 0) return;\n        ranges.push([start, i + 1]);\n        categories.add(o.category);\n        if (o.level === 'reject') reject = true;\n        else review = true;\n      });\n    }\n  }\n\n  if (options.regex !== false) {\n    const raw = String(text || '');\n    REGEX_RULES.forEach((rule) => {\n      rule.re.lastIndex = 0;\n      let m = rule.re.exec(raw);\n      while (m) {\n        const start = Array.from(raw.slice(0, m.index)).length;\n        const len = Array.from(m[0]).length;\n        ranges.push([start, start + len]);\n        categories.add(rule.category);\n        if (rule.level === 'reject') reject = true;\n        else review = true;\n        m = rule.re.exec(raw);\n      }\n    });\n  }\n\n  // 合并重叠区间\n  ranges.sort((a, b) => a[0] - b[0]);\n  const merged = [];\n  ranges.forEach((r) => {\n    const last = merged[merged.length - 1];\n    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);\n    else merged.push([r[0], r[1]]);\n  });\n\n  return { reject, review, ranges: merged, categories: Array.from(categories) };\n}\n\nmodule.exports = { check, loadTerms, FALLBACK_TERMS };\n", "llm.js": "/**\n * 大模型调用（可选，OpenAI 兼容接口）\n * 未配置 AI_BASE_URL / AI_API_KEY 时 available() 为 false，调用方走模板化拼接，\n * 保证「不编答案、链路可用」，符合文档 9.12 链路⑦的降级要求。\n */\nconst https = require('https');\nconst http = require('http');\nconst { URL } = require('url');\n\nfunction available() {\n  return !!(process.env.AI_BASE_URL && process.env.AI_API_KEY);\n}\n\nfunction post(urlStr, payload, timeout) {\n  return new Promise((resolve, reject) => {\n    const u = new URL(urlStr);\n    const body = Buffer.from(JSON.stringify(payload));\n    const mod = u.protocol === 'http:' ? http : https;\n    const req = mod.request(\n      {\n        hostname: u.hostname,\n        port: u.port || (u.protocol === 'http:' ? 80 : 443),\n        path: `${u.pathname}${u.search}`,\n        method: 'POST',\n        headers: {\n          'Content-Type': 'application/json',\n          Authorization: `Bearer ${process.env.AI_API_KEY}`,\n          'Content-Length': body.length,\n        },\n        timeout: timeout || 8000,\n      },\n      (res) => {\n        const chunks = [];\n        res.on('data', (c) => chunks.push(c));\n        res.on('end', () => {\n          const text = Buffer.concat(chunks).toString('utf8');\n          if (res.statusCode < 200 || res.statusCode >= 300) {\n            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`));\n            return;\n          }\n          try {\n            resolve(JSON.parse(text));\n          } catch (e) {\n            reject(new Error('BAD_JSON'));\n          }\n        });\n      }\n    );\n    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));\n    req.on('error', reject);\n    req.write(body);\n    req.end();\n  });\n}\n\nfunction parseJsonLoose(text) {\n  const s = String(text || '').trim();\n  const fence = s.match(/```(?:json)?\\s*([\\s\\S]*?)```/);\n  const raw = fence ? fence[1] : s;\n  const start = raw.indexOf('{');\n  const end = raw.lastIndexOf('}');\n  if (start === -1 || end === -1) return null;\n  try {\n    return JSON.parse(raw.slice(start, end + 1));\n  } catch (e) {\n    return null;\n  }\n}\n\n/**\n * @returns {Promise<{json:object|null, raw:string, model:string}>}\n */\nasync function chatJSON(system, user, opts = {}) {\n  if (!available()) return { json: null, raw: '', model: 'template' };\n  const model = process.env.AI_MODEL || 'hunyuan-lite';\n  const url = `${process.env.AI_BASE_URL.replace(/\\/$/, '')}/chat/completions`;\n  const res = await post(\n    url,\n    {\n      model,\n      temperature: opts.temperature === undefined ? 0.2 : opts.temperature,\n      max_tokens: opts.maxTokens || 600,\n      messages: [\n        { role: 'system', content: system },\n        { role: 'user', content: user },\n      ],\n    },\n    opts.timeout || 8000\n  );\n  const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;\n  return { json: parseJsonLoose(content), raw: String(content || ''), model };\n}\n\nmodule.exports = { available, chatJSON, parseJsonLoose };\n", "mediahelper.js": "/** 媒体归属与安全状态校验（11.3 / 16.3）：不信任前端传的 checkStatus */\nconst { coll, COL } = require('./db');\n\nfunction filePath(fileId) {\n  return String(fileId || '').replace(/^cloud:\\/\\/[^/]+\\//, '');\n}\n\nfunction belongsTo(fileId, uid) {\n  const p = filePath(fileId);\n  if (!p) return false;\n  return p.indexOf(`/${uid}/`) > -1;\n}\n\nfunction isAvatar(fileId) {\n  return filePath(fileId).indexOf('avatar/') === 0;\n}\n\n/**\n * 由「原图 fileId」推导「送审图 fileId」。\n *\n * 前端上传约定（见 miniprogram/utils/media.js）：\n *   展示图 p/{yyyyMM}/{uid}/{rand}.jpg\n *   送审图 p/{yyyyMM}/{uid}/{rand}_c.jpg   ← 同目录、同 basename、加 _c 后缀\n *   视频封面 v/{yyyyMM}/{uid}/{rand}_poster.jpg\n *\n * ⚠️ 为什么不用客户端传的 checkFileId：\n *   客户端可以传任意一张自己的\"干净图\"当 checkFileId，\n *   服务端拿干净图送审、却把结论写到违规的 fileId 上 → 违规图被放行。\n *   所以送审图必须由服务端从 fileId 推导，不可由客户端指定。\n *\n * @returns {string} 推导出的送审图 fileId；无法推导时返回空串\n */\nfunction deriveCheckFileId(fileId, type) {\n  const raw = String(fileId || '');\n  if (!raw) return '';\n  // 拆出 cloud://env.xxx/ 前缀与内部路径（filePath 只给内部路径，这里要保留前缀才能下载）\n  const m = raw.match(/^(cloud:\\/\\/[^/]+\\/)(.*)$/);\n  const prefix = m ? m[1] : '';\n  const p = m ? m[2] : raw;\n  if (!p) return '';\n  const ext = type === 'video' ? '_poster.jpg' : '_c.jpg';\n  const base = p.replace(/\\.[^./]+$/, '');\n  if (base === p) return ''; // 没有扩展名，推导失败\n  return `${prefix}${base}${ext}`;\n}\n\n/**\n * @returns {{ok:boolean, reason?:string, status?:string}}\n */\nasync function verifyMedia(fileId, uid) {\n  if (!fileId) return { ok: false, reason: 'EMPTY' };\n  if (!belongsTo(fileId, uid)) return { ok: false, reason: 'NOT_OWNER' };\n  try {\n    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();\n    if (!res.data || !res.data.length) return { ok: true, status: 'unknown' };\n    const st = res.data[0].checkStatus || 'pass';\n    if (st === 'risky') return { ok: false, reason: 'RISKY', status: st };\n    return { ok: true, status: st };\n  } catch (e) {\n    return { ok: true, status: 'unknown' };\n  }\n}\n\nasync function registerMedia({ fileId, uid, type, size, mime, w, h, duration, checkStatus, checkSource, inUse }) {\n  if (!fileId) return;\n  try {\n    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();\n    if (res.data && res.data.length) {\n      await coll(COL.mediaAssets).doc(res.data[0]._id).update({\n        data: {\n          checkStatus: checkStatus || res.data[0].checkStatus,\n          checkSource: checkSource || '',\n          // inUse 为真且当前未计数时补 1（头像等\"始终在用\"的资源）\n          ...(inUse && !(res.data[0].refCount > 0) ? { refCount: 1 } : {}),\n        },\n      });\n      return;\n    }\n    await coll(COL.mediaAssets).add({\n      data: {\n        fileId,\n        uid,\n        type: type || 'image',\n        size: size || 0,\n        mime: mime || '',\n        w: w || 0,\n        h: h || 0,\n        duration: duration || 0,\n        checkStatus: checkStatus || 'pending',\n        checkSource: checkSource || '',\n        // inUse：头像这类\"注册即在用\"的资源初始计数为 1，\n        // 否则会被 taskCleanup 当成 24h 未引用的垃圾删掉（头像变空白）\n        refCount: inUse ? 1 : 0,\n        createdAt: new Date(),\n      },\n    });\n  } catch (e) {\n    // 媒体台账失败不阻断业务\n  }\n}\n\n/**\n * 该文件是否仍被引用（用户头像 / 帖子媒体）。\n * 供 taskCleanup 删除前二次校验，避免误删在用资源。\n */\nasync function isStillReferenced(fileId) {\n  if (!fileId) return false;\n  try {\n    // 1. 用户头像（avatar 是 {fileId, status} 对象）\n    const u = await coll(COL.users).where({ 'avatar.fileId': fileId }).limit(1).get();\n    if (u.data && u.data.length) return true;\n  } catch (e) { /* ignore */ }\n  try {\n    // 2. 帖子媒体（media 是数组，'media.fileId' 匹配数组元素）\n    // ⚠️ 不要加 status: {$ne:'deleted'} —— 实测带 $ne 的数组字段查询\n    //    一条都匹配不到，会让二次校验形同虚设（被删帖子的图也判成\"没引用\"）。\n    //    已删除的帖子媒体被清理本来就是期望行为，多留一次不扣分。\n    const p = await coll(COL.posts).where({ 'media.fileId': fileId }).limit(1).get();\n    if (p.data && p.data.length) return true;\n  } catch (e) { /* ignore */ }\n  return false;\n}\n\nasync function incRef(fileId, delta) {\n  if (!fileId) return;\n  try {\n    const res = await coll(COL.mediaAssets).where({ fileId }).limit(1).get();\n    if (res.data && res.data.length) {\n      const cur = Math.max(0, (res.data[0].refCount || 0) + delta);\n      await coll(COL.mediaAssets).doc(res.data[0]._id).update({ data: { refCount: cur } });\n    } else {\n      // 台账里没有这条记录 → 计数无从谈起，告警（不静默吞掉）\n      console.warn('[incRef] mediaAssets 无此记录，refCount 未变更:', fileId);\n    }\n  } catch (e) {\n    // ⚠️ 不再静默：计数失败会导致文件被 taskCleanup 误删，必须留日志\n    console.error('[incRef] 引用计数更新失败:', fileId, delta, e && (e.errMsg || e.message));\n  }\n}\n\nmodule.exports = { verifyMedia, registerMedia, incRef, belongsTo, isAvatar, filePath, isStillReferenced, deriveCheckFileId };\n", "msg.js": "/** 站内消息（8.10 / C-17）：点赞收藏按「帖子 + 24h」合并 */\nconst { coll, _, COL, db, dayKey } = require('./db');\n\n/**\n * @param {{toUid:string,type:string,title:string,body:string,refType?:string,refId?:string,dedupeKey?:string}} m\n */\nasync function push(m) {\n  if (!m || !m.toUid) return null;\n  const data = {\n    toUid: m.toUid,\n    type: m.type,\n    title: m.title,\n    body: m.body || '',\n    refType: m.refType || 'post',\n    refId: m.refId || '',\n    count: 1,\n    read: false,\n    dedupeKey: m.dedupeKey || '',\n    createdAt: db.serverDate(),\n    updatedAt: db.serverDate(),\n  };\n\n  if (m.dedupeKey) {\n    try {\n      const res = await coll(COL.messages).where({ dedupeKey: m.dedupeKey }).limit(1).get();\n      if (res.data && res.data.length) {\n        await coll(COL.messages).doc(res.data[0]._id).update({\n          data: { count: _.inc(1), read: false, body: m.body, updatedAt: db.serverDate() },\n        });\n        return res.data[0]._id;\n      }\n    } catch (e) {\n      // 继续走新增\n    }\n  }\n\n  try {\n    const res = await coll(COL.messages).add({ data });\n    return res._id;\n  } catch (e) {\n    return null;\n  }\n}\n\nfunction likeDedupeKey(postId) {\n  return `like:${postId}:${dayKey()}`;\n}\n\nfunction favDedupeKey(postId) {\n  return `fav:${postId}:${dayKey()}`;\n}\n\nasync function unreadCount(uid) {\n  try {\n    const res = await coll(COL.messages).where({ toUid: uid, read: false }).count();\n    return res.total || 0;\n  } catch (e) {\n    return 0;\n  }\n}\n\nmodule.exports = { push, likeDedupeKey, favDedupeKey, unreadCount };\n", "present.js": "/** 出参整形：字段裁剪与脱敏（16.4） */\nconst { ms } = require('./db');\n\n/**\n * 糖果色头像序号（1-5），按 floor 派生。\n * 与前端 utils/format.js 的 avatarIndex 同算法，但入参不同：\n *   前端用 uid（个人主页头像，按人取色是合理的）\n *   这里用 floor（评论头像，按楼层取色 → 不同评论不同色，不可关联作者）\n */\nfunction avatarIndex(floor) {\n  const n = Number(floor) || 0;\n  if (!n) return 1;\n  let h = 0;\n  for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;\n  return (h % 5) + 1;\n}\n\nfunction postBrief(p, inter) {\n  const media = p.media || [];\n  const first = media[0] || {};\n  const isVideo = first.type === 'video';\n  const i = inter || {};\n  return {\n    id: p._id,\n    shortId: p.shortId,\n    board: p.board,\n    title: p.title || '',\n    excerpt: p.aiSummary || p.excerpt || '',\n    cover: p.coverFileId || first.posterFileId || first.fileId || '',\n    // 封面真实宽高：前端靠它按比例占位，图片还没下载完高度就是对的，\n    // 不会先按 4:3 撑开再跳一下（老帖子这两个字段是 0，前端 onload 兜底）\n    coverW: first.w || 0,\n    coverH: first.h || 0,\n    mediaType: isVideo ? 'video' : (media.length ? 'image' : ''),\n    duration: first.duration || 0,\n    likeCount: (p.stats && p.stats.likeCount) || 0,\n    favCount: (p.stats && p.stats.favCount) || 0,\n    commentCount: (p.stats && p.stats.commentCount) || 0,\n    liked: !!i.liked,\n    faved: !!i.faved,\n    createdAt: ms(p.createdAt),\n    publishedAt: ms(p.publishedAt),\n    expired: !!p.expired,\n    status: p.status,\n    // 周报帖（board='digest'）：前端据此渲染成周报卡，并带上可跳转的原帖列表\n    isDigest: !!p.isDigest,\n    digestItems: p.digestItems || [],\n    itemCount: p.itemCount || 0,\n  };\n}\n\nfunction postFull(p, isMine) {\n  const stats = Object.assign({}, p.stats || {});\n  if (!isMine) {\n    delete stats.citedCount;\n    delete stats.viewCount;\n  }\n  return {\n    id: p._id,\n    shortId: p.shortId,\n    board: p.board,\n    title: p.title || '',\n    content: p.content,\n    media: (p.media || []).map((m) => ({\n      type: m.type,\n      fileId: m.fileId,\n      posterFileId: m.posterFileId || '',\n      w: m.w || 0,\n      h: m.h || 0,\n      duration: m.duration || 0,\n      size: m.size || 0,\n      mime: m.mime || '',\n      checkStatus: m.checkStatus || 'pass',\n    })),\n    coverFileId: p.coverFileId || '',\n    fields: p.fields || {},\n    tags: p.tags || [],\n    aiSummary: p.aiSummary || '',\n    // 周报帖：带上引用的原帖列表（详情页渲染成可点击的列表）\n    isDigest: !!p.isDigest,\n    digestItems: p.digestItems || [],\n    itemCount: p.itemCount || 0,\n    status: p.status,\n    risk: isMine ? p.risk : { level: p.risk ? p.risk.level : 'pass' },\n    stats,\n    createdAt: ms(p.createdAt),\n    publishedAt: ms(p.publishedAt),\n    expired: !!p.expired,\n    rejectReason: isMine ? p.rejectReason || '' : '',\n    hideReason: isMine ? p.hideReason || '' : '',\n  };\n}\n\n/**\n * 评论出参（匿名化：不下发 authorUid）\n * 第二个参数为当前用户 uid，用于计算 isMine 标记\n *\n * ⚠️ avatarIdx 是「糖果色头像」的序号（1-5），按 floor 派生而非按作者派生：\n *   若按作者算，同一作者所有评论同色 → 等于用颜色重建作者画像，破坏匿名。\n *   按楼层号算则每个评论独立取色，视觉上照样有色彩变化，但不可关联。\n */\nfunction commentItem(c, replies, uid) {\n  return {\n    id: c._id,\n    floor: c.floor,\n    avatarIdx: avatarIndex(c.floor),\n    content: c.status === 'deleted' ? '该评论已删除' : c.content,\n    createdAt: ms(c.createdAt),\n    status: c.status === 'deleted' ? 'deleted' : c.status,\n    isMine: !!uid && c.authorUid === uid,\n    replyCount: c.replyCount || 0,\n    replies: (replies || []).map((r) => ({\n      id: r._id,\n      floor: r.floor,\n      avatarIdx: avatarIndex(r.floor),\n      replyToFloor: r.replyToFloor || 0,\n      content: r.status === 'deleted' ? '该评论已删除' : r.content,\n      createdAt: ms(r.createdAt),\n      isMine: !!uid && r.authorUid === uid,\n    })),\n  };\n}\n\nmodule.exports = { postBrief, postFull, commentItem };\n", "rate.js": "/** 限流（9.1 / 8.13） */\nconst { coll, _, COL, db } = require('./db');\n\n/**\n * 固定窗口计数\n *\n * ⚠️ 限流必须 fail-closed：计数失败时若直接放行，\n * 请求既没被计数也没被拦下 → 限流形同虚设（可被并发绕过）。\n * 所以这里的约定是：\n *   - 正常路径：原子自增 → 读回真实 count → count <= limit 才放行\n *   - 异常路径：尽力把计数补上（补不上则按已超限处理）→ 默认拒绝\n *\n * @returns {Promise<{allowed:boolean, count:number, limit:number, degraded?:boolean}>}\n */\nasync function hit(uid, action, limit, windowMs) {\n  const now = Date.now();\n  const start = now - (now % windowMs);\n  const id = `${uid}:${action}:${start}`;\n  const c = coll(COL.rateLimits);\n  try {\n    const res = await c.doc(id).update({ data: { count: _.inc(1) } });\n    if (!res.stats || !res.stats.updated) throw new Error('MISS');\n    const doc = await c.doc(id).get();\n    const count = (doc.data && doc.data.count) || 1;\n    return { allowed: count <= limit, count, limit };\n  } catch (e) {\n    // 到这里说明「文档还不存在」或「数据库异常」，两条路都要自己把计数写回去\n    let counted = false;\n    try {\n      await c.add({ data: { _id: id, uid, action, windowStart: new Date(start), count: 1 } });\n      counted = true;\n    } catch (err) {\n      // 并发下唯一键冲突：文档已存在 → 改成自增\n      try {\n        const r2 = await c.doc(id).update({ data: { count: _.inc(1) } });\n        counted = !!(r2 && r2.stats && r2.stats.updated);\n      } catch (e2) { /* 计数补不上 → 走下面的 fail-closed */ }\n    }\n\n    if (!counted) {\n      // 计数完全没写进去：无法判断是否超限 → 拒绝（fail-closed）\n      console.error('[rate.hit] 计数失败，已拒绝本次请求:', uid, action, e && (e.message || e));\n      return { allowed: false, count: limit + 1, limit, degraded: true };\n    }\n\n    // 计数补上了：读回真实值再判断（并发自增后可能已超限）\n    let count = 1;\n    try {\n      const doc = await c.doc(id).get();\n      count = (doc.data && doc.data.count) || 1;\n    } catch (e3) {\n      // 读不回来但计数已写入：保守按超限处理\n      console.error('[rate.hit] 读取计数失败，已拒绝本次请求:', uid, action, e3 && (e3.message || e3));\n      return { allowed: false, count: limit + 1, limit, degraded: true };\n    }\n    return { allowed: count <= limit, count, limit };\n  }\n}\n\n/** 读取当前窗口已用次数（不计数） */\nasync function peek(uid, action, windowMs) {\n  const now = Date.now();\n  const start = now - (now % windowMs);\n  const id = `${uid}:${action}:${start}`;\n  try {\n    const doc = await coll(COL.rateLimits).doc(id).get();\n    return (doc.data && doc.data.count) || 0;\n  } catch (e) {\n    return 0;\n  }\n}\n\nmodule.exports = { hit, peek };\n", "resp.js": "/** 统一响应包络（9.1）+ 错误码表（附录 A） */\nconst ERR_MSG = {\n  40001: '参数有误',\n  40002: '字数超限',\n  40003: '内容不合规',\n  40010: '内容里有不合规表述',\n  40100: '请重新进入小程序',\n  40101: '请先输入邀请码',\n  40301: '没有权限执行该操作',\n  40302: '账号已被封禁',\n  40303: '你暂时不能发布内容',\n  40304: '邀请码已停用',\n  40401: '内容不存在或已删除',\n  40402: '内容不存在或已删除',\n  40901: '已经提交过了',\n  40902: '你已经操作过了',\n  40903: '这个邀请码已经被使用了',\n  40904: '该内容已被处理',\n  42901: '操作太频繁，稍后再试',\n  42902: '今天的使用次数用完了',\n  50000: '请求超时',\n  50001: '服务异常',\n  50002: '审核接口异常',\n  50003: 'AI 异常',\n  50004: '存储异常',\n  50005: '小程序码生成失败',\n};\n\nfunction traceId() {\n  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;\n}\n\nfunction ok(data) {\n  return { code: 0, msg: 'ok', data: data === undefined ? {} : data, traceId: traceId() };\n}\n\nfunction fail(code, msg, data) {\n  return { code, msg: msg || ERR_MSG[code] || '请求失败', data: data || {}, traceId: traceId() };\n}\n\nmodule.exports = { ok, fail, ERR_MSG, traceId };\n", "tokenize.js": "/** 分词：中文 2-gram + 英文/数字整词，用于 searchTokens 与检索 */\nconst STOP = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '也', '很', '都']);\n\nfunction tokenize(text, max = 200) {\n  const s = String(text || '')\n    .toLowerCase()\n    .replace(/[^\\u4e00-\\u9fa5a-z0-9]+/g, ' ');\n  const out = new Set();\n  s.split(/\\s+/).filter(Boolean).forEach((seg) => {\n    if (/^[a-z0-9]+$/.test(seg)) {\n      if (seg.length >= 2) out.add(seg);\n      return;\n    }\n    const chars = Array.from(seg).filter((c) => !STOP.has(c));\n    for (let i = 0; i < chars.length; i += 1) {\n      if (i + 1 < chars.length) out.add(chars[i] + chars[i + 1]);\n      else if (chars.length === 1) out.add(chars[i]);\n    }\n  });\n  return Array.from(out).slice(0, max);\n}\n\n/** 关键词查询用的高区分度 token（去重后最多 12 个） */\nfunction queryTokens(keyword) {\n  return tokenize(keyword, 12);\n}\n\nmodule.exports = { tokenize, queryTokens };\n", "wxapi.js": "/** 微信内容安全接口封装（15.1 L2/L3），接口不可用时的降级策略集中在此 */\nconst { cloud } = require('./db');\n\n// 这类错误属于\"能力未开通/额度/参数\"，不是内容问题\nconst UNAVAILABLE = [-604101, 48001, 40013, 40125, 40164, 45009, 61010, 41004, -1];\n\nfunction isUnavailable(err) {\n  const code = err && (err.errCode !== undefined ? err.errCode : err.code);\n  const msg = String((err && (err.errMsg || err.message)) || '');\n  if (UNAVAILABLE.indexOf(Number(code)) > -1) return true;\n  return /invalid appid|no permission|unauthorized|access token|api unauthorized|not support/i.test(msg);\n}\n\nfunction strictMode() {\n  // 默认 strict：内容安全接口不可用时转人工复核（review），不直接放行。\n  // 如需临时放宽（如尚未开通内容安全能力的开发阶段），\n  // 在云函数环境变量里设 MODERATION_MODE=lenient 即可覆盖。\n  return String(process.env.MODERATION_MODE || 'strict') === 'strict';\n}\n\n/** 文本检测：pass / review / risky */\nasync function msgSecCheck(content, openid) {\n  const text = String(content || '').slice(0, 2500);\n  if (!text) return { suggest: 'pass', degraded: false };\n  try {\n    const res = await cloud.openapi.security.msgSecCheck({\n      version: 2,\n      openid,\n      scene: 3,\n      content: text,\n    });\n    const r = (res && res.result) || {};\n    const suggest = r.suggest || 'pass';\n    return { suggest: suggest === 'pass' ? 'pass' : 'review', label: r.label || 0, degraded: false };\n  } catch (e) {\n    if (isUnavailable(e)) {\n      console.warn('[msgSecCheck] unavailable, degrade:', e.errCode || e.errMsg);\n      return { suggest: strictMode() ? 'review' : 'pass', degraded: true, errCode: e.errCode };\n    }\n    // 其他异常（含真实 openid 缺失、网络抖动）：不把用户提问/发帖一刀切拦掉，\n    // strict 模式下保守置 review 走人工，lenient 模式下放行并标记 degraded。\n    console.warn('[msgSecCheck] error, degrade:', e.errCode || e.errMsg);\n    return { suggest: strictMode() ? 'review' : 'pass', degraded: true, errCode: e.errCode };\n  }\n}\n\n/** 图片检测：pass / review / risky（buffer ≤1MB、≤750×1334） */\nasync function imgSecCheck(buffer, contentType) {\n  if (!buffer) return { status: 'review', degraded: false };\n  try {\n    const res = await cloud.openapi.security.imgSecCheck({\n      media: { contentType: contentType || 'image/jpeg', value: buffer },\n    });\n    const errCode = res && res.errCode;\n    if (errCode === 0) return { status: 'pass', degraded: false };\n    if (errCode === 87014) return { status: 'risky', degraded: false };\n    return { status: 'review', degraded: false, errCode };\n  } catch (e) {\n    if (isUnavailable(e)) {\n      console.warn('[imgSecCheck] unavailable, degrade:', e.errCode || e.errMsg);\n      return { status: strictMode() ? 'review' : 'pass', degraded: true, errCode: e.errCode };\n    }\n    // 图片异常一律保守：人工复核（不做 lenient 放行，避免黄色图片进主流程）\n    return { status: 'review', degraded: true, errCode: e.errCode };\n  }\n}\n\nmodule.exports = { msgSecCheck, imgSecCheck, strictMode };\n"}
  var __LIB = __path.join('/var/user', 'lib')

  Object.keys(__FILES).forEach(function (n) {
    var fp = __path.join(__LIB, n)
    var m = new __Module(fp, null)
    m.filename = fp
    m.paths = __Module._nodeModulePaths(__path.dirname(fp))
    m.exports = {}
    m.__pendingCompile = true
    require.cache[fp] = m
  })

  function __tryLib(request, parent) {
    if (!parent || !parent.filename) return null
    if (request.indexOf('./') !== 0 && request.indexOf('../') !== 0) return null
    var fp = __path.normalize(__path.join(__path.dirname(parent.filename), request))
    if (fp.slice(-3) !== '.js') fp += '.js'
    if (fp.indexOf(__LIB) !== 0) return null
    var base = __path.basename(fp)
    if (!__FILES[base]) return null
    var m = require.cache[fp]
    if (m && m.__pendingCompile) {
      m.__pendingCompile = false
      m._compile(__FILES[base], fp)
    }
    return m.exports
  }

  var __origLoad = __Module._load
  __Module._load = function (request, parent, isMain) {
    var r = __tryLib(request, parent)
    if (r !== null) return r
    return __origLoad(request, parent, isMain)
  }
})()
/* ===== END MEM-INJECT ===== */
const { cloud, coll, _, COL, db, decodeCursor, encodeCursor, ms } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth, resolveCtx } = require('./lib/auth');
const { postBrief } = require('./lib/present');

/** 作者公开信息（2026-11-16 起所有人可见）：只下发昵称+头像临时链接，绝不下发 authorUid */
async function resolveAuthors(uids) {
  const uniq = [...new Set((uids || []).filter(Boolean))];
  if (!uniq.length) return {};
  try {
    const r = await coll(COL.users)
      .where({ _id: _.in(uniq) })
      .field({ nickname: true, avatar: true })
      .limit(100)
      .get();
    const users = r.data || [];
    const fileIds = users
      .map((u) => (u.avatar && u.avatar.fileId && u.avatar.status !== 'risky' ? u.avatar.fileId : ''))
      .filter(Boolean);
    const urlMap = {};
    if (fileIds.length) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: fileIds });
        (tr.fileList || []).forEach((f) => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch (e) { /* 头像链接失败降级为空，前端回退匿名头像 */ }
    }
    const map = {};
    users.forEach((u) => {
      const av = u.avatar || {};
      const fileId = av.status !== 'risky' ? av.fileId || '' : '';
      map[u._id] = { nickname: String(u.nickname || '').trim(), avatarUrl: fileId ? urlMap[fileId] || '' : '' };
    });
    return map;
  } catch (e) {
    console.warn('[postList resolveAuthors]', e && (e.errMsg || e.message));
    return {};
  }
}
const { queryTokens } = require('./lib/tokenize');
const { getConfig } = require('./lib/config');

const MAX_PAGE = 20;
// 周报帖的板块标识（taskWeeklyDigest 写入时用这个）
const DIGEST_BOARD = 'digest';
// interactions.type → 出参字段名。
// 数据库里存的是 'like' / 'fav'，但 present.postBrief 读的是 'liked' / 'faved'
//（与 postDetail 的 myInteraction、meList 的收藏列表口径一致）。
// 之前 postList 直接用 it.type 当键名，差一个字母 d → 永远对不上，
// 恒返回 liked=false / faved=false：前端刷新后以为没点赞过，
// 再点一次变成「取消点赞」，计数互相抵消。
const INTER_KEY = { like: 'liked', fav: 'faved' };

async function loadInteractions(uid, ids) {
  const map = {};
  if (!uid || !ids.length) return map;
  try {
    const res = await coll(COL.interactions)
      .where({ uid, targetType: 'post', targetId: _.in(ids) })
      .limit(100)
      .get();
    (res.data || []).forEach((it) => {
      const key = INTER_KEY[it.type];
      if (!key) return;
      map[it.targetId] = map[it.targetId] || {};
      map[it.targetId][key] = true;
    });
  } catch (e) { /* ignore */ }
  return map;
}

exports.main = withAuth(async (event, ctx) => {
  const board = event.board;
  if (board && ['life', 'study', 'food'].indexOf(board) === -1) return fail(40001);

  const sort = event.sort === 'latest' ? 'latest' : 'hot';
  let pageSize = Number(event.pageSize) || 10;
  pageSize = Math.max(1, Math.min(pageSize, MAX_PAGE));
  const cursor = decodeCursor(event.cursor);
  const keyword = String(event.keyword || '').trim();
  // 搜索模式：sort=latest 按时间，其余（relevant/hot/未传）一律相关程度排序
  const isSearch = !!keyword;
  const config = await getConfig();

  const where = { status: 'published' };
  // 周报帖（board='digest'）不进板块信息流：
  //   以前是 _.in([board, 'digest'])，结果每个板块第一条都是同一篇周报（它 hotScore
  //   999999 必然排第一），板块自己的内容被压在下面。现在板块只查本板块。
  // 周报统一从首页 AI 引导卡右侧的「周报」入口进（pages/digest），
  // 那里靠下面首屏附带的 latestDigest + postDetail 的 pastDigests 列期次。
  // 首页（无 board）这里不加 board 条件：会与现有 status+hotScore 索引组合失配，
  // 首页信息流里的周报由前端 index.js 的 filter(x => !x.isDigest) 剔除。
  if (board) where.board = board;

  if (keyword) {
    const tokens = queryTokens(keyword);
    const multi = tokens.filter((t) => Array.from(t).length > 1);
    if (multi.length) {
      where.searchTokens = _.all(multi);
    } else {
      // 纯单字关键词（如「包」）：帖子的 searchTokens 只含 2-gram/英文整词，
      // 单字 token 永远命中不了索引 → 退化为标题/摘要正则匹配（压缩空白后整词匹配）
      where.$titleRe = db.RegExp({
        regexp: keyword.replace(/\s+/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        options: 'i',
      });
    }
  }

  if (cursor) {
    if (sort === 'latest') where.createdAt = _.lt(new Date(cursor.t));
    else where.hotScore = _.lt(cursor.h);
  }

  // $titleRe 占位（单字搜索）：展开成 (title RE 或 excerpt RE) 与其余条件的 or 组合
  let finalWhere = where;
  if (where.$titleRe) {
    const re = where.$titleRe;
    delete where.$titleRe;
    finalWhere = _.or([Object.assign({}, where, { title: re }), Object.assign({}, where, { excerpt: re })]);
  }

  let query = coll(COL.posts).where(finalWhere);
  query = sort === 'latest'
    ? query.orderBy('createdAt', 'desc')
    : query.orderBy('hotScore', 'desc');

  // —— 搜索 + 相关程度排序：拉 50 条候选内存打分（title 命中权重最高），offset 分页 ——
  // 游标格式 off:N（与信息流的时间/热度游标无关）
  const offMatch = isSearch && sort !== 'latest' ? /^off:(\d+)$/.exec(String(event.cursor || '')) : null;
  if (offMatch) {
    let cands;
    try {
      cands = await coll(COL.posts).where(finalWhere).orderBy('hotScore', 'desc').limit(50).get();
    } catch (e) {
      console.error('[postList relevant]', e && (e.message || e));
      return fail(50001);
    }
    const kw = keyword.replace(/\s+/g, '').toLowerCase();
    const scored = (cands.data || []).map((p) => {
      const title = String(p.title || '').toLowerCase();
      const excerpt = String(p.excerpt || p.content || '').toLowerCase();
      let s = (p.hotScore || 0) / 100;
      if (kw) {
        s += (title.split(kw).length - 1) * 10;        // 标题每命中一处 +10
        if (kw && title.indexOf(kw) === 0) s += 5;     // 标题开头命中再 +5
        s += (excerpt.split(kw).length - 1) * 3;       // 摘要每命中一处 +3
      }
      return { p, s };
    }).sort((a, b) => b.s - a.s);
    const start = Number(offMatch[1]) || 0;
    const page = scored.slice(start, start + pageSize).map((x) => x.p);
    const inter = await loadInteractions(ctx.uid, page.map((p) => p._id));
    const authors = await resolveAuthors(page.map((p) => p.authorUid));
    const expireDays = (config.hot && config.hot.expireDays) || 90;
    const list = page.map((p) => {
      const brief = postBrief(p, inter[p._id]);
      if (!p.expired && p.publishedAt && Date.now() - ms(p.publishedAt) > expireDays * 86400000) {
        brief.expired = true;
      }
      brief.isMine = p.authorUid === ctx.uid;
      brief.author = authors[p.authorUid] || null;
      return brief;
    });
    const hasMore = start + page.length < scored.length;
    return ok({
      list,
      nextCursor: hasMore ? `off:${start + page.length}` : null,
      hasMore,
      total: scored.length,
    });
  }

  let res;
  try {
    res = await query.skip(0).limit(pageSize + 1).get();
  } catch (e) {
    console.error('[postList query]', e && (e.message || e));
    return fail(50001);
  }

  const rows = res.data || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);

  const inter = await loadInteractions(ctx.uid, page.map((p) => p._id));
  const expireDays = (config.hot && config.hot.expireDays) || 90;
  // 作者公开信息批量解析（一次 users 查 + 一次临时链接换算）
  const authors = await resolveAuthors(page.map((p) => p.authorUid));

  const list = page.map((p) => {
    const brief = postBrief(p, inter[p._id]);
    if (!p.expired && p.publishedAt && Date.now() - ms(p.publishedAt) > expireDays * 86400000) {
      brief.expired = true;
    }
    // 本人发的帖（2026-11-16：前端据此展示用户自己设置的头像，他人仍看匿名糖果色）
    brief.isMine = p.authorUid === ctx.uid;
    brief.author = authors[p.authorUid] || null;
    return brief;
  });


  let nextCursor = null;
  if (hasMore && page.length) {
    const last = page[page.length - 1];
    nextCursor = sort === 'latest'
      ? encodeCursor({ t: ms(last.createdAt) })
      : encodeCursor({ h: last.hotScore || 0 });
  }

  const data = { list, nextCursor, hasMore };
  // total 仅首屏给出，避免每次翻页都 count
  if (!cursor) {
    try {
      const cnt = await coll(COL.posts).where(where).count();
      data.total = cnt.total || 0;
    } catch (e) {
      data.total = list.length;
    }
    // 首屏附带最新一条周报：首页「周报入口」用（信息流里不再放周报卡）
    // 失败不阻塞列表返回，前端拿不到就不显示入口
    try {
      const dr = await coll(COL.posts)
        .where({ status: 'published', board: DIGEST_BOARD })
        .orderBy('publishedAt', 'desc')
        .limit(1)
        .get();
      if (dr.data && dr.data[0]) data.latestDigest = postBrief(dr.data[0]);
    } catch (e) { /* 无周报/查询失败 → 前端隐藏入口 */ }
  }
  return ok(data);
}, {});
