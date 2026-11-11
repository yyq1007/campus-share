/**
 * taskWeeklyDigest（每周一 09:00 定时触发）
 *
 * 流程：扫近 30 天 published 帖 → 按 hotScore 排序取前 N 条 → 交给免密钥大模型
 *      写一篇跨板块的周度总结 → **写成一条真实帖子**（board='digest'）
 *
 * 为什么写成帖子而不是独立的 weeklyDigest 集合：
 *  - 帖子能直接进详情页：AI 总结全文 + 引用的原帖列表（可点击跳转）
 *  - 能被点赞/收藏/分享，天然复用现有的帖子详情页与互动逻辑
 *  - 不用新增前端页面
 *
 * 关键约定：
 *  - board 用 'digest'（不是 life/study/food）→ 各板块列表用
 *    where.board = _.in([板块, 'digest']) 把它一起查出来，天然置顶在第一位
 *  - _id 用 ISO 周号（2026-W46）→ 同周重复跑是覆盖写，天然幂等
 *  - authorUid 用固定的系统作者 'system-digest' → 后台任务按用户清理帖子时不会误删
 *  - 引用的帖子 id 全部来自数据库真实数据，模型只负责组织语言（防幻觉）
 *  - 模型不可用时降级：仍然写一篇「无 AI 总结」的周报，只列帖子
 */
const { coll, _, COL, db, ms, cloud } = require('./lib/db');

const PAGE = 100;          // 单次 get 上限
const MAX_ROUNDS = 20;     // 最多扫 2000 条
const MAX_PICKS = 12;      // 最多选 12 条进周报
const MIN_PICKS = 1;       // 少于这个数就不写周报（没内容可总结）
const WEEK_DAYS = 30;      // 统计窗口：近 30 天
// ⚠️ 为什么用 30 天而不是 7 天：
//   周报每周一篇，但站内发帖量少（冷启动期一周可能 0 篇）→ 窗口太窄会长期没内容。
//   30 天保证「每周都有周报可写」，代价是可能包含上一周的旧帖（可接受）。
// ⚠️ 为什么不在 where 里用时间阈值过滤：
//   云函数写的 publishedAt 是 Date 类型，种子脚本写的是 ISO 字符串，
//   两种类型互不匹配 → _.gte(ISO阈值) 查不到 Date 类型的帖（实测 30 天窗口漏 1 篇）。
//   所以改成：只按 status 查回来，在代码里用 ms() 统一换算成时间戳再判断。
const CONTENT_MAX = 1200;  // 周报正文最大字数（超出截断）

const BOARD_LABEL = { life: '生活', study: '学习', food: '美食' };

// 周报帖的板块标识（不属于任何真实板块，各板块列表会把它一起查出来）
// ⚠️ 扫帖选精选时必须排除它，否则周报会把自己选进去
const DIGEST_BOARD = 'digest';
// 系统作者：周报没有真人作者，用固定 uid。后台清理任务按 users.authorUid
// 删帖，这个 uid 不在 users 里 → 周报不会被误删。
const SYSTEM_AUTHOR = 'system-digest';

/** ISO 周号：2026-W46。用于周报 _id（天然按周去重） */
function isoWeekKey(date) {
  const d = new Date(date || Date.now());
  // ISO: 周四决定年份
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;      // 周一=0
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // 到本周周四
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 86400000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * 扫描近 N 天的 published 帖，按 hotScore 排序取前 MAX_PICKS 条。
 * 热度低的帖子也收（只要有过一点互动），避免冷启动期一篇都没有。
 */
async function pickHotPosts(sinceTs, untilTs) {
  const rows = [];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let page = [];
    try {
      // ⚠️ where 里不带时间条件：publishedAt 有 Date / ISO 字符串两种类型，
      //   用 _.gte(阈值) 会漏掉另一种类型的帖。改成拉回来在代码里用 ms() 判断。
      // ⚠️ 必须排除周报帖自己（board='digest'）：周报也在 posts 集合里，
      //   而且 hotScore 最高（置顶用），不排除的话它会把自己选进精选列表，
      //   详情页就会出现「周报精选 → 周报」的自引用。
      const res = await coll(COL.posts)
        .where({ status: 'published', board: _.neq(DIGEST_BOARD) })
        .field({
          _id: true, title: true, content: true, excerpt: true, board: true,
          hotScore: true, stats: true, media: true, coverFileId: true,
          publishedAt: true, createdAt: true, fields: true,
        })
        .orderBy('hotScore', 'desc')
        .skip(round * PAGE)
        .limit(PAGE)
        .get();
      page = res.data || [];
    } catch (e) {
      console.error('[taskWeeklyDigest] query failed', e && (e.message || e));
      break;
    }
    if (!page.length) break;
    // 时间窗口在代码里判断（兼容 Date 对象 / ISO 字符串两种 publishedAt）
    // ⚠️ ms() 对 Date 对象和 ISO 字符串都能换算，但读不出时间时返回 0。
    //   这里把「读不出时间」当作新帖收进来（宁可多收一条，不可漏收），
    //   否则老数据格式异常时周报会永远空着。
    for (const p of page) {
      const ts = ms(p.publishedAt) || ms(p.createdAt);
      if (ts && ts < sinceTs) continue;    // 明确太旧 → 跳过
      if (untilTs && ts > untilTs) continue; // 补发往期：晚于模拟时刻的帖子不算
      rows.push(p);
    }
    if (page.length < PAGE) break;
  }

  // 热度倒序；热度相同的按时间新的在前
  rows.sort((a, b) => {
    const d = (b.hotScore || 0) - (a.hotScore || 0);
    if (Math.abs(d) > 0.0001) return d;
    return ms(b.publishedAt) - ms(a.publishedAt);
  });

  return rows.slice(0, MAX_PICKS);
}

/** 帖子的封面 fileId（图片取原图，视频取封面） */
function coverOf(p) {
  if (p.coverFileId) return p.coverFileId;
  const m = (p.media || [])[0];
  if (!m) return '';
  return m.type === 'video' ? (m.posterFileId || '') : (m.fileId || '');
}

/**
 * 调免密钥大模型写周报。
 * ⚠️ 引用编号由我们给定（[1][2]…），模型只能引用这些编号，
 *    不允许自己编造 → 返回后我们再校验它引用的编号是否越界。
 */
async function writeSummary(picks) {
  const ctx = picks.map((p, i) => {
    const s = p.stats || {};
    const board = BOARD_LABEL[p.board] || p.board;
    const extras = [];
    if (p.fields && p.fields.shop) extras.push(`店铺/来源：${p.fields.shop}`);
    if (p.fields && p.fields.course) extras.push(`课程：${p.fields.course}`);
    if (p.fields && p.fields.price) extras.push(`价格：${p.fields.price}`);
    if (s.likeCount) extras.push(`${s.likeCount} 赞`);
    if (s.favCount) extras.push(`${s.favCount} 收藏`);
    if (s.commentCount) extras.push(`${s.commentCount} 评论`);
    return `[${i + 1}] 标题：${p.title}\n板块：${board}\n内容：${String(p.content || '').slice(0, 240)}\n互动：${extras.join('、') || '暂无'}`;
  }).join('\n\n');

  const system = [
    '你是「好物分享」校园小程序的周报编辑，把本周同学们分享的好东西汇总成一篇周报。',
    '规则：',
    '1. 只依据下面提供的分享内容写，禁止编造不存在的分享；',
    '2. 引用某条分享时在句末标注 [编号]，编号只能用提供的编号；',
    '3. 不按板块分类，写成一段流畅的周报正文，突出大家真正在用的好东西；',
    '4. 语气亲切、活泼，像同学之间的分享，不要像公告；',
    '5. 控制在 400 字以内。',
  ].join('\n');

  const ai = cloud.ai();
  const model = ai.createModel('hunyuan-exp');
  const res = await model.generateText({
    model: 'hy3-preview',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `本周分享：\n${ctx}\n\n请写本周周报。` },
    ],
  });

  const text = (res && res.text)
    || (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content)
    || '';

  if (!text) throw new Error('model returned empty text');
  return text;
}

/** 校验模型引用的编号是否越界（防幻觉：引用了不存在的帖子） */
function sanitizeSummary(text, picks) {
  const valid = new Set(picks.map((_, i) => i + 1));
  const cited = new Set();
  const cleaned = String(text).replace(/\[(\d+)\]/g, (m, n) => {
    const i = Number(n);
    if (!valid.has(i)) return '';
    cited.add(i);
    return `[${i}]`;
  });
  return { text: cleaned.replace(/\s{2,}/g, ' ').trim(), cited: [...cited].sort((a, b) => a - b) };
}

exports.main = async (event) => {
  // event.at（可选）：补发往期用。传时间戳或日期字符串（如 '2026-11-02T09:00:00+08:00'），
  // 函数按那个时刻生成对应 ISO 周的周报；定时触发器不传 event，行为不变。
  let now = Date.now();
  const atRaw = event && (event.at || event.timestamp || event.date);
  if (atRaw) {
    const t = new Date(atRaw).getTime();
    if (!Number.isNaN(t) && t > 0 && t <= Date.now()) now = t;
  }
  const untilTs = now;
  const sinceTs = now - WEEK_DAYS * 86400000;
  const weekKey = isoWeekKey(now);

  console.log('[taskWeeklyDigest] start', JSON.stringify({ weekKey, sinceTs, untilTs, days: WEEK_DAYS, at: atRaw || null }));

  let picks = [];
  try {
    picks = await pickHotPosts(sinceTs, untilTs);
  } catch (e) {
    console.error('[taskWeeklyDigest] pick failed', e && (e.message || e));
  }

  if (!picks.length || picks.length < MIN_PICKS) {
    console.log('[taskWeeklyDigest] no posts in window, skip');
    return { ok: true, weekKey, picked: 0, wrote: false, reason: 'no_posts' };
  }

  // 生成周报正文（模型失败则降级为「只列帖子」）
  let summary = '';
  let cited = [];
  let degraded = false;
  try {
    const raw = await writeSummary(picks);
    const s = sanitizeSummary(raw, picks);
    summary = s.text;
    cited = s.cited;
  } catch (e) {
    degraded = true;
    console.error('[taskWeeklyDigest] model fail, degrade to list-only', e && (e.message || e));
    summary = `本周共有 ${picks.length} 条新分享，下面是同学们票数最高的几条。`;
  }

  if (summary.length > CONTENT_MAX) summary = summary.slice(0, CONTENT_MAX) + '…';

  // 组装引用帖列表（id 全部来自数据库真实数据，模型不参与决定）
  const items = picks.map((p, i) => ({
    no: i + 1,
    postId: p._id,
    title: p.title || '',
    board: p.board || '',
    boardLabel: BOARD_LABEL[p.board] || p.board || '',
    excerpt: p.excerpt || String(p.content || '').slice(0, 60),
    coverFileId: coverOf(p),
    likeCount: (p.stats && p.stats.likeCount) || 0,
    favCount: (p.stats && p.stats.favCount) || 0,
    commentCount: (p.stats && p.stats.commentCount) || 0,
    hotScore: p.hotScore || 0,
    cited: cited.indexOf(i + 1) >= 0,
  }));

  // 组装成一条真实帖子。字段对齐 postCreate 的形状，让详情页能正常渲染。
  const doc = {
    _id: weekKey,                    // ISO 周号 → 同周重复跑是覆盖，天然幂等
    shortId: 'W' + weekKey.replace('-', '').slice(4),  // 短 id（分享用）
    board: DIGEST_BOARD,             // 特殊板块 → 各板块列表都能查到它
    title: '周报',
    content: summary,                // 正文 = AI 总结全文
    excerpt: summary.slice(0, 80),   // 列表页摘要
    aiSummary: summary,
    fields: {},                      // 周报没有板块字段
    tags: ['周报', '精选'],
    media: [],                       // 周报不带图
    coverFileId: '',
    status: 'published',
    authorUid: SYSTEM_AUTHOR,        // 系统作者，不会被清理任务误删
    isDigest: true,                  // 前端识别周报卡
    digestItems: items,              // 引用的原帖（详情页渲染成可跳转列表）
    itemCount: items.length,
    degraded,                        // true = 没调通模型，只有列表
    weekKey,
    searchTokens: [],                // 不进搜索（避免被搜到）
    stats: { likeCount: 0, favCount: 0, commentCount: 0, citedCount: 0, viewCount: 0 },
    hotScore: 999999,                // 置顶用（各板块列表都会带上它）
    // 补发往期时用模拟时刻（往期周报列表按 publishedAt 排序/显示日期）；
    // 定时正常触发时 now = Date.now()，与 serverDate() 等价
    updatedAt: new Date(now),
    createdAt: new Date(now),
    publishedAt: new Date(now),
  };

  try {
    // 幂等写入：先删同 _id 再写（云开发 add 同 id 会报错）
    try {
      await coll(COL.posts).doc(weekKey).remove();
    } catch (e) { /* 不存在，忽略 */ }
    await coll(COL.posts).add({ data: doc });
  } catch (e) {
    console.error('[taskWeeklyDigest] write failed', e && (e.message || e));
    return { ok: false, weekKey, picked: picks.length, wrote: false, error: String(e && e.message || e).slice(0, 200) };
  }

  console.log('[taskWeeklyDigest] done', JSON.stringify({
    weekKey, picked: picks.length, cited: cited.length, degraded,
  }));
  return { ok: true, weekKey, picked: picks.length, wrote: true, degraded, cited: cited.length };
};
