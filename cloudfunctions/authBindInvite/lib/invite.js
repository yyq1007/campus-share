/**
 * 用户个人邀请码（区别于「绑定用的注册邀请码」）
 * 8 位大写字母数字，沿用 db.randomBase32 的去混淆字符集，保证可印刷、可手输
 */
const { coll, COL, randomBase32 } = require('./db');

const LEN = 8;
const MAX_TRY = 5;

async function mintUserCode() {
  for (let i = 0; i < MAX_TRY; i += 1) {
    const code = randomBase32(LEN);
    try {
      const r = await coll(COL.users).where({ myInviteCode: code }).limit(1).get();
      if (!r.data || !r.data.length) return code;
    } catch (e) {
      // 查询失败不阻断：概率上重复极低，直接返回
      return code;
    }
  }
  return randomBase32(LEN);
}

/**
 * 补齐：已绑定但还没有个人邀请码的老用户
 * @returns {Promise<string>} 个人邀请码（可能为空）
 */
async function ensureUserCode(user) {
  if (!user) return '';
  if (user.myInviteCode) return user.myInviteCode;
  if (!user.inviteCode) return ''; // 未绑定注册码的用户不生成，避免绕过邀请制
  const code = await mintUserCode();
  try {
    await coll(COL.users).doc(user._id).update({ data: { myInviteCode: code } });
  } catch (e) {
    return '';
  }
  return code;
}

module.exports = { mintUserCode, ensureUserCode, LEN };
