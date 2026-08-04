// refresh_token 表的 repository。
// 设计：access token 短期不入库；refresh token 入库（hash），登出/改密 = 删行/标记 revoked = 失效。
const crypto = require('crypto');
const { db } = require('../db');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const refreshTokenRepository = {
  /** 签发并存储一条 refresh token，返回明文（只这一次） */
  async issue(userId, expiresAt) {
    // 明文用 crypto.randomBytes，足够随机且无需 jwt
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(
      'INSERT INTO refresh_token (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [userId, hashToken(token), expiresAt],
    );
    return token;
  },

  /** 校验 refresh token 是否有效（存在、未撤销、未过期）。有效则返回 userId。 */
  async verify(token) {
    if (!token) return null;
    const [rows] = await db.query(
      `SELECT user_id FROM refresh_token
        WHERE token_hash = ? AND revoked = 0 AND expires_at > NOW()
        LIMIT 1`,
      [hashToken(token)],
    );
    return rows[0]?.user_id ?? null;
  },

  /** 撤销单个 token（登出/轮换时调） */
  async revoke(token) {
    if (!token) return;
    await db.query('UPDATE refresh_token SET revoked = 1 WHERE token_hash = ?', [hashToken(token)]);
  },

  /** 撤销某用户全部 refresh token（改密/注销时调） */
  async revokeAllForUser(userId) {
    await db.query('UPDATE refresh_token SET revoked = 1 WHERE user_id = ?', [userId]);
  },

  /** 清理已过期 token（可选的维护任务） */
  async prune() {
    await db.query('DELETE FROM refresh_token WHERE expires_at < NOW()');
  },
};

module.exports = { refreshTokenRepository, hashToken };
