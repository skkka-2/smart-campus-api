const cors = require('koa2-cors');
const config = require('../config');

/**
 * CORS 白名单:开发允许 localhost,生产按 CORS_ORIGINS env 配置
 */
module.exports = cors({
  origin: (ctx) => {
    const requestOrigin = ctx.request.header.origin;
    if (!requestOrigin) return '';
    if (config.cors.origins.includes('*')) return requestOrigin;
    return config.cors.origins.includes(requestOrigin) ? requestOrigin : '';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
});
