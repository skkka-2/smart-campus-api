const jwt = require('jsonwebtoken');
const config = require('../config');

// 双令牌设计：
// - access token：短期（默认 15 分钟），存 Authorization header，用于 API 鉴权
// - refresh token：长期（默认 7 天），存 httpOnly cookie，只用于换 access
// access 不入库（短期，过期自然失效）；refresh 入库（refreshTokenRepository），
//   登出/改密 = 标记 revoked = 失效

/** 签发 access token（短期） */
function signAccess(payload, options = {}) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
    ...options,
  });
}

// 向后兼容：原 sign 签 access token
function sign(payload, options = {}) {
  return signAccess(payload, options);
}

/** 校验 access token，失败抛 JsonWebTokenError / TokenExpiredError */
function verify(token) {
  return jwt.verify(token, config.jwt.secret);
}

/** 从 Authorization header 解析裸 token（去 Bearer） */
function extractFromHeader(authorizationHeader) {
  if (!authorizationHeader) return null;
  const parts = authorizationHeader.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return parts[0]; // 允许直接传裸 token
}

module.exports = {
  sign,
  signAccess,
  verify,
  extractFromHeader,
};
