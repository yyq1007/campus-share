/** 热度分（9.22）：加权互动 / 时间衰减；含 1 的基座分避免零互动新帖沉底 */
const { ms } = require('./db');

function hotScore(stats, publishedAt, now) {
  const s = stats || {};
  const w = 3 * (s.likeCount || 0) + 4 * (s.favCount || 0) + 5 * (s.commentCount || 0) + 6 * (s.citedCount || 0);
  const hours = Math.max(0, ((now || Date.now()) - ms(publishedAt)) / 3600000);
  return Number(((w + 1) / Math.pow(hours + 2, 1.5)).toFixed(4));
}

module.exports = { hotScore };
