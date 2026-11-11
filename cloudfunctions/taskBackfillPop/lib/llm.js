/**
 * 大模型调用（可选，OpenAI 兼容接口）
 * 未配置 AI_BASE_URL / AI_API_KEY 时 available() 为 false，调用方走模板化拼接，
 * 保证「不编答案、链路可用」，符合文档 9.12 链路⑦的降级要求。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

function available() {
  return !!(process.env.AI_BASE_URL && process.env.AI_API_KEY);
}

function post(urlStr, payload, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = Buffer.from(JSON.stringify(payload));
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.AI_API_KEY}`,
          'Content-Length': body.length,
        },
        timeout: timeout || 8000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error('BAD_JSON'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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

/**
 * @returns {Promise<{json:object|null, raw:string, model:string}>}
 */
async function chatJSON(system, user, opts = {}) {
  if (!available()) return { json: null, raw: '', model: 'template' };
  const model = process.env.AI_MODEL || 'hunyuan-lite';
  const url = `${process.env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const res = await post(
    url,
    {
      model,
      temperature: opts.temperature === undefined ? 0.2 : opts.temperature,
      max_tokens: opts.maxTokens || 600,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    opts.timeout || 8000
  );
  const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
  return { json: parseJsonLoose(content), raw: String(content || ''), model };
}

module.exports = { available, chatJSON, parseJsonLoose };
