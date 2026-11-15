/**
 * postAssist（9.22，拍照即发帖）
 * 链路：鉴权 → 幂等 → 频控(assist_1day, 3/天, fail-closed) → 图片安全(imgSecCheck 先行)
 *      → 免密钥多模态大模型识图 → 结构化建议（board/title/content/fields/tags/observations）
 * 硬约束：
 *  - 纯建议函数：不写 posts 集合，持久化只发生在 postCreate（前端带 aiAssist:true 打标）
 *  - 图片不合规直接 40010 驳回，不消耗模型调用（省成本 + 合规链路统一）
 *  - 低置信度(<0.6)：title/content 置空，前端黄条引导手写，不硬编内容
 *  - 全部字段可选可弃：前端拿到什么用什么，缺哪块表单留哪块空白
 * 契约见交互稿《postAssist-拍照即发帖-交互稿-v1.0》第五章 + MVP文档第 9 章 9.22
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 25000 });
const { coll, COL, charLen } = require('./lib/db');
const { ok, fail } = require('./lib/resp');
const { withAuth } = require('./lib/auth');
const rate = require('./lib/rate');
const { imgSecCheck } = require('./lib/wxapi');
const { belongsTo, registerMedia, deriveCheckFileId } = require('./lib/mediahelper');

const BOARDS = ['life', 'study', 'food'];
const ASSIST_DAILY = 3;          // 每日限用 3 次（含「换个写法」）
const MAX_CHECK_BYTES = 1024 * 1024; // imgSecCheck 上限 1MB
const TITLE_MAX = 40;
const CONTENT_MAX = 200;         // 建议 content 上限（低于表单 2000，AI 不写长文）
const FIELD_MAX = 60;
const CONF_LOW = 0.6;            // 低置信度阈值：文案字段置空

const SYSTEM_PROMPT = [
  '你是校园好物分享社区的发布助手。用户上传了一张照片，请根据照片可见内容生成发帖建议。',
  '严格规则：',
  '1. 只描述照片中可见的内容，禁止编造品牌、产地、购买渠道等照片外信息；',
  '2. 涉及价格只能给「参考价」区间，文本中须体现"参考"字样；',
  '3. 所有输出都是建议，不确定的字段允许为空字符串或省略；',
  '4. board 从 life（宿舍好物/日常闲置）/study（学习资料/课程笔记）/food（食堂美食/店铺小吃）中给出主判定与次选，附 0~1 置信度；',
  '5. title 不超过 20 字，校园分享口吻；content 不超过 120 字，第一人称、口语化；fields.shop 概括位置/成色/参考价（无法确定就省略该键）；',
  '6. tags：2~6 字、具体可检索的词（如"保温杯""高数笔记"），最多 5 个，不要泛词；',
  '7. observations：列出识别依据（主体/颜色/成色/参考价等），k 不超过 6 字、v 不超过 30 字，src 固定为 "photo"；',
  '8. confidence 为整体识别置信度 0~1；低于 0.6 时 title 与 content 必须输出空字符串。',
  '只输出 JSON，不要任何多余文本：',
  '{"board":{"top":"life","conf":0.82,"runnerUp":"study","conf2":0.18},"title":"...","content":"...","fields":{"shop":"..."},"tags":["..."],"observations":[{"k":"主体","v":"保温水杯","src":"photo"}],"confidence":0.82}',
].join('\n');

/** llm 返回容错解析（aiStructure lib/llm.js 同款口径，此处不依赖 HTTP 版 llm.js） */
function parseJsonLoose(text) {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : s;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function clip(str, max) {
  const arr = Array.from(String(str || '').trim());
  return arr.slice(0, max).join('');
}

/** 归一化模型输出：字段校验 + 截断 + 低置信度置空（白名单外内容一律丢弃） */
function normalize(json) {
  if (!json || typeof json !== 'object') return null;
  const out = {
    board: null,
    title: '',
    content: '',
    fields: {},
    tags: [],
    observations: [],
    confidence: 0,
  };

  const conf = Math.max(0, Math.min(1, Number(json.confidence) || 0));
  out.confidence = Math.round(conf * 100) / 100;
  const low = conf > 0 && conf < CONF_LOW;

  // board：白名单内才输出（主判定 + 次选 + 双置信度）
  if (json.board && typeof json.board === 'object') {
    const top = String(json.board.top || '');
    const runnerUp = String(json.board.runnerUp || '');
    if (BOARDS.indexOf(top) > -1) {
      out.board = {
        top,
        conf: Math.max(0, Math.min(1, Number(json.board.conf) || 0)),
        runnerUp: BOARDS.indexOf(runnerUp) > -1 && runnerUp !== top ? runnerUp : '',
        conf2: Math.max(0, Math.min(1, Number(json.board.conf2) || 0)),
      };
    }
  }

  // 文案：低置信度置空（不硬编内容），高置信度按上限截断
  if (!low) {
    out.title = clip(json.title, TITLE_MAX);
    out.content = clip(json.content, CONTENT_MAX);
  }

  // fields：只收白名单键（与 postCreate FIELD_KEYS 口径一致）
  if (json.fields && typeof json.fields === 'object') {
    ['shop', 'price', 'location', 'course', 'teacher', 'material'].forEach((k) => {
      const v = clip(json.fields[k], FIELD_MAX);
      if (v) out.fields[k] = v;
    });
  }

  // tags：≤5 个，每个 ≤8 字
  if (Array.isArray(json.tags)) {
    out.tags = json.tags
      .map((t) => clip(t, 8))
      .filter(Boolean)
      .slice(0, 5);
  }

  // observations：白名单 src + 长度截断
  if (Array.isArray(json.observations)) {
    out.observations = json.observations
      .map((o) => {
        if (!o || typeof o !== 'object') return null;
        const k = clip(o.k, 6);
        const v = clip(o.v, 30);
        const src = ['photo', 'web', 'infer'].indexOf(String(o.src)) > -1 ? String(o.src) : 'photo';
        if (!k || !v) return null;
        return { k, v, src };
      })
      .filter(Boolean)
      .slice(0, 6);
  }

  return out;
}

/** 图片安全先行：下载送审图（服务端从 fileId 推导 _c.jpg，不信客户端）→ imgSecCheck */
async function precheckImage(fileId, uid) {
  const derived = deriveCheckFileId(fileId, 'image');
  const target = derived || fileId;
  let buffer = null;
  try {
    const r = await cloud.downloadFile({ fileID: target });
    buffer = r && r.fileContent;
  } catch (e) {
    if (target !== fileId) {
      try {
        const r = await cloud.downloadFile({ fileID: fileId });
        buffer = r && r.fileContent;
      } catch (e2) { /* 双双失败走下方空判 */ }
    }
  }
  if (!buffer || !buffer.length) {
    // 读不到图：无法审也无法识别 → 按参数错误处理（前端会降级回手动）
    return { blocked: false, missing: true };
  }
  const r = await imgSecCheck(buffer, 'image/jpeg');
  // 检测结论登记台账（与 mediaCheck 同一集合，发布时 postCreate 复核）
  registerMedia({ fileId, uid, type: 'image', checkStatus: r.status, checkSource: 'postAssist_pre' })
    .catch(() => {});
  if (r.status === 'risky') return { blocked: true };
  // pass / review（含降级）：review 不等于违规，纯建议场景放行（不公开、只给本人看）
  return { blocked: false };
}

exports.main = withAuth(async (event, ctx) => {
  const fileId = String(event.fileId || '').trim();
  const clientReqId = String(event.clientReqId || '').trim();
  if (!fileId || !clientReqId) return fail(40001, '缺少文件 ID 或幂等键');
  if (fileId.indexOf('cloud://') !== 0) return fail(40001, '文件 ID 不合法');
  if (!belongsTo(fileId, ctx.uid)) return fail(40401, '文件不存在或无权访问');

  // ---------- 幂等：同一 clientReqId 直接返回上次结果（迟到重试/重复点击不重复计费） ----------
  try {
    const dup = await coll(COL.assistLogs).where({ clientReqId, uid: ctx.uid }).limit(1).get();
    if (dup.data && dup.data.length) {
      const cached = dup.data[0].result;
      if (cached) return ok({ ...cached, duplicated: true });
    }
  } catch (e) { /* 幂等查询失败不阻断（后续写入失败则放弃缓存） */ }

  // ---------- 频控：3 次/天 fail-closed（含「换个写法」，防成本滥用） ----------
  const hit = await rate.hit(ctx.uid, 'assist_1day', ASSIST_DAILY, 24 * 60 * 60 * 1000);
  if (!hit.allowed) return fail(42902, '今天的使用次数用完了，明天再来，AI 也要休息');

  // ---------- 内容安全先行：不通过直接驳回，不消耗模型调用 ----------
  const pre = await precheckImage(fileId, ctx.uid);
  if (pre.blocked) {
    return fail(40010, '这张照片过不了内容检测，换一张试试');
  }
  if (pre.missing) {
    return fail(40001, '照片读取失败，请重新上传后再试');
  }

  // ---------- 免密钥多模态识图 ----------
  let tempUrl = '';
  try {
    const t = await cloud.getTempFileURL({ fileList: [fileId] });
    tempUrl = (t.fileList && t.fileList[0] && t.fileList[0].tempFileURL) || '';
  } catch (e) { /* 空串走下方失败 */ }
  if (!tempUrl) return fail(50004, '照片读取失败，请重试');

  let answer = '';
  try {
    // 云函数端大模型 API：wx-server-sdk ≥4.0.1 的 cloud.ai()
    // 与 askQuery 同款口径：createModel('hunyuan-exp') 是提供方 ID（固定），
    // generateText 的 model 字段才是具体模型——识图用 hunyuan-vision（混元多模态）。
    // generateText 返回原始响应 res.choices[0].message.content
    const model = cloud.ai().createModel('hunyuan-exp');
    const res = await model.generateText({
      model: process.env.AI_VISION_MODEL || 'hunyuan-vision',
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: tempUrl } },
            { type: 'text', text: '请分析这张照片并输出发帖建议 JSON。' },
          ],
        },
      ],
    });
    answer = (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '';
  } catch (e) {
    console.error('[postAssist] model fail', e && (e.message || e));
    return fail(50003, 'AI 开小差了，已切回手动填写');
  }

  const result = normalize(parseJsonLoose(answer));
  if (!result) return fail(50003, 'AI 开小差了，已切回手动填写');

  // ---------- 幂等缓存：写入 assistLogs（不写 posts；持久化只在 postCreate） ----------
  try {
    await coll(COL.assistLogs).add({
      data: {
        clientReqId,
        uid: ctx.uid,
        fileId,
        result,
        createdAt: new Date(),
      },
    });
  } catch (e) {
    // 缓存失败不阻断：建议已生成，直接返回（极端场景重复调用会多计一次频控，可接受）
    console.warn('[postAssist] assistLogs 写入失败', e && (e.message || e));
  }

  return ok(result);
});

// 供单测使用（mock ai 返回 → normalize 行为验证），业务方勿调
exports._internals = { normalize, parseJsonLoose, clip };
