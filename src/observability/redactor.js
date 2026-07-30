const crypto = require('crypto');
const config = require('../config');

function hashUserId(userId) {
  if (!userId) return 'anonymous';
  return crypto
    .createHmac('sha256', config.jwt.secret)
    .update(String(userId))
    .digest('hex')
    .slice(0, 16);
}

function getPromptStats(text) {
  const content = String(text || '');
  return {
    length: content.length,
    hasJobIntent: /岗位|职位|实习|投递|简历|匹配|推荐/.test(content),
    hasApplyIntent: /投递|申请|留言/.test(content),
  };
}

function safeJson(value, maxLength = 800) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function previewText(text, maxLength = 500) {
  if (!text) return '';
  const masked = String(text)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/AKID[A-Za-z0-9]+/g, '[secret_id]')
    .replace(/[A-Za-z0-9+/=]{24,}/g, '[secret]')
    .replace(/1[3-9]\d{9}/g, '[phone]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
  return masked.length > maxLength ? `${masked.slice(0, maxLength)}...` : masked;
}

function summarizeToolArgs(args = {}) {
  const summary = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (/message|resume|content|password|token|secret|key/i.test(key)) {
      summary[key] = '[redacted]';
    } else if (typeof value === 'string') {
      summary[key] = value.length > 80 ? `${value.slice(0, 80)}...` : value;
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

module.exports = {
  hashUserId,
  getPromptStats,
  previewText,
  safeJson,
  summarizeToolArgs,
};
