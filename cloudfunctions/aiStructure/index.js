/**
 * aiStructure（9.20，内部函数）
 * 只对 published 且 aiSummary 为空的帖子执行一次；只补空字段，不覆盖用户输入
 * 未配置大模型时用本地规则（首句摘要 + 关键词标签 + 价格抽取），保证链路完整
 */
const { coll, COL, db, excerpt, charLen } = require('./lib/db');
const { tokenize } = require('./lib/tokenize');
const llm = require('./lib/llm');

const SYSTEM_PROMPT = [
  '你是校园好物分享社区的内容编辑。',
  '阅读帖子后输出 JSON：{"tags":["≤5个2-6字标签"],"summary":"≤60字摘要","fieldsPatch":{"price":"人均价格","shop":"店铺/地点名"}}',
  'tags 要具体可检索（如"麻辣烫""一食堂"），不要泛词；summary 客观描述、不要复述标题（卡片标题位已展示）；fieldsPatch 只输出能确定的值，没有就省略。',
  '只输出 JSON。',
].join('\n');

/** 本地摘要：取前两句，压缩空白 */
function localSummary(title, content) {
  const text = String(content || '').replace(/\s+/g, '');
  const parts = text.split(/(?<=[。！？!?])/).filter(Boolean);
  let s = parts.slice(0, 2).join('');
  if (charLen(s) < 12) s = text;
  return excerpt(s, 120);
}

/** 本地标签：2-gram 词频 + 字段值 */
function localTags(title, content, fields) {
  const freq = {};
  tokenize(`${title} ${title} ${content}`).forEach((t) => {
    if (charLen(t) < 2) return;
    freq[t] = (freq[t] || 0) + 1;
  });
  const top = Object.keys(freq)
    .filter((t) => freq[t] > 1 || charLen(t) >= 3)
    .sort((a, b) => freq[b] - freq[a])
    .slice(0, 3);
  const fromFields = ['shop', 'location', 'course', 'material']
    .map((k) => (fields && fields[k]) || '')
    .filter(Boolean)
    .map((v) => excerpt(v, 6));
  return Array.from(new Set(top.concat(fromFields))).slice(0, 5);
}

function localPrice(fields, content) {
  if (fields && fields.price) return '';
  const m = String(content || '').match(/(?:人均|大概|约|只要|花了)?\s*([0-9]{1,4}(?:\.[0-9])?)\s*(?:元|块|r|R)/);
  return m ? m[1] : '';
}

exports.main = async (event) => {
  const postId = String((event && event.postId) || '').trim();
  if (!postId) return { ok: false, msg: 'missing postId' };

  let p = null;
  try {
    const r = await coll(COL.posts).doc(postId).get();
    p = r.data;
  } catch (e) {
    return { ok: false, msg: 'not found' };
  }
  if (!p) return { ok: false, msg: 'not found' };
  if (p.status !== 'published') return { ok: false, msg: 'not published' };
  if (p.aiSummary && p.aiStructured) return { ok: true, skipped: true, tags: p.tags || [], summary: p.aiSummary };

  const fields = p.fields || {};
  let tags = [];
  let summary = '';
  let fieldsPatch = {};

  if (llm.available()) {
    try {
      const user = `标题：${p.title || ''}\n板块：${p.board}\n正文：${excerpt(p.content, 600)}\n已有字段：${JSON.stringify(fields)}`;
      const r = await llm.chatJSON(SYSTEM_PROMPT, user, { timeout: 8000, maxTokens: 400 });
      if (r.json) {
        if (Array.isArray(r.json.tags)) tags = r.json.tags.map((t) => String(t).slice(0, 8)).filter(Boolean).slice(0, 5);
        if (typeof r.json.summary === 'string') summary = r.json.summary.trim().slice(0, 120);
        if (r.json.fieldsPatch && typeof r.json.fieldsPatch === 'object') fieldsPatch = r.json.fieldsPatch;
      }
    } catch (e) {
      console.warn('[aiStructure] llm failed, fallback to local', e && e.message);
    }
  }

  if (!tags.length) tags = localTags(p.title, p.content, fields);
  if (!summary) summary = localSummary(p.title, p.content);

  // 只补空字段
  const patch = {};
  ['shop', 'price', 'location', 'course', 'teacher', 'material'].forEach((k) => {
    const v = fieldsPatch[k];
    if (v && !fields[k]) patch[`fields.${k}`] = String(v).slice(0, 60);
  });
  if (!fields.price) {
    const price = localPrice(fields, p.content);
    if (price) patch['fields.price'] = price;
  }

  try {
    await coll(COL.posts).doc(postId).update({
      data: Object.assign({ tags, aiSummary: summary, aiStructured: true, updatedAt: db.serverDate() }, patch),
    });
  } catch (e) {
    console.error('[aiStructure] update failed', e && e.message);
    return { ok: false, msg: 'update failed' };
  }

  // 触发向量化：必须 await，SCF 返回后容器冻结，未 await 的调用会丢失
  const { cloud } = require('./lib/db');
  await Promise.race([
    cloud.callFunction({ name: 'aiEmbed', data: { postId } }),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]).catch(() => {});

  return { ok: true, tags, summary, fieldsPatch: patch };
};
