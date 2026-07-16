const jwt = require('jsonwebtoken');
const config = require('../config');

/** 签发 JWT */
function sign(payload, options = {}) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    ...options,
  });
}

/** 校验 JWT,失败抛出 JsonWebTokenError / TokenExpiredError */
function verify(token) {
  return jwt.verify(token, config.jwt.secret);
}

/** 从 Authorization header 里解析出裸 token(去 Bearer 前缀) */
function extractFromHeader(authorizationHeader) {
  if (!authorizationHeader) return null;
  const parts = authorizationHeader.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return parts[0]; // 允许直接传裸 token
}

module.exports = { sign, verify, extractFromHeader };
