/**
 * 临时探针：枚举 cloud.ai 各提供方 × 视觉模型的可用性（官方示例公开图片）
 * 目的：找到免密钥、真正支持 image_url 的组合，用于修复 postAssist
 * 用完即删，不处理任何用户数据
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TEST_IMAGE = 'https://qcloudimg.tencent-cloud.cn/raw/42c198dbc0b57ae490e57f89aa01ec23.png';

const https = require('https');

function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuf(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** content 变体构造 */
function buildContent(mode, dataUrl) {
  const textPart = { type: 'text', text: '这张图里是什么？用一个短语回答。' };
  if (mode === 'dataURL') {
    return [{ type: 'image_url', image_url: { url: dataUrl } }, textPart];
  }
  if (mode === 'urlStr') {
    // image_url 直接给字符串（部分代理只认这种）
    return [{ type: 'image_url', image_url: TEST_IMAGE }, textPart];
  }
  if (mode === 'textFirst') {
    return [textPart, { type: 'image_url', image_url: { url: TEST_IMAGE } }];
  }
  // 默认：官方 OpenAI 风格
  return [{ type: 'image_url', image_url: { url: TEST_IMAGE } }, textPart];
}

const COMBOS = [
  // 新假设：hunyuan-exp 通道 + 控制台已开通的真实模型名
  { provider: 'hunyuan-exp', model: 'hy-vision-2.0-instruct', mode: 'url' },
  { provider: 'hunyuan-exp', model: 'hy-vision-2.0-instruct', mode: 'dataURL' },
  // 对照：cloudbase 通道（仍然 403 的那组）
  { provider: 'cloudbase', model: 'hy-vision-2.0-instruct', mode: 'url' },
  // 文本对照
  { provider: 'hunyuan-exp', model: 'hy3-preview', mode: 'text-only' },
];

function buildMessages(mode) {
  if (mode === 'text-only') {
    return [{ role: 'user', content: '回复"ok"两个字即可。' }];
  }
  return [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: TEST_IMAGE } },
        { type: 'text', text: '这张图里是什么？用一个短语回答。' },
      ],
    },
  ];
}

async function probe(combo) {
  const started = Date.now();
  try {
    const model = cloud.ai().createModel(combo.provider);
    const res = await model.generateText({
      model: combo.model,
      messages: buildMessages(combo.mode),
    });
    const text = (res && res.text)
      || (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content)
      || '';
    return {
      ...combo,
      ok: !!String(text).trim(),
      ms: Date.now() - started,
      answerHead: String(text).slice(0, 80),
    };
  } catch (e) {
    const detail = (e && e.response && e.response.data)
      ? JSON.stringify(e.response.data).slice(0, 200)
      : '';
    return {
      ...combo,
      ok: false,
      ms: Date.now() - started,
      err: (String((e && e.message) || e).slice(0, 120) + ' ' + detail).trim(),
    };
  }
}

exports.main = async () => {
  const results = [];
  for (const combo of COMBOS) {
    results.push(await probe(combo));
  }
  return results;
};
