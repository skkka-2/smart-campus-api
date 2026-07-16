const { BizError } = require('../utils/response');

/**
 * 全局错误处理中间件——所有 controller 抛出的异常在这里被兜住
 * 只有 BizError 会露出真实 message,其他一律返回"服务器错误"避免泄漏内部信息
 */
const errorMiddleware = async (ctx, next) => {
  try {
    await next();

    // 如果路由都没匹配到,ctx.status 会是 404
    if (ctx.status === 404 && !ctx.body) {
      ctx.fail('接口不存在', 404, 404);
    }
  } catch (err) {
    if (err instanceof BizError) {
      ctx.fail(err.message, err.code, err.httpStatus);
      return;
    }

    // JWT 相关
    if (err.name === 'TokenExpiredError') {
      ctx.fail('登录已过期,请重新登录', 401, 401);
      return;
    }
    if (err.name === 'JsonWebTokenError') {
      ctx.fail('无效的登录凭证', 401, 401);
      return;
    }

    console.error('[error]', err);
    ctx.fail('服务器内部错误', 500, 500);
  }
};

module.exports = errorMiddleware;
