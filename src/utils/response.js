/**
 * 统一响应格式
 *   {
 *     code: 0,           // 0 表示成功,非 0 为业务错误码
 *     message: 'ok',
 *     data: any | null
 *   }
 *
 * 挂在 ctx 上后,handler 只需 `ctx.success(data)` / `ctx.fail(msg, code, http)`。
 */

/**
 * 业务错误。抛出后由 error 中间件统一响应。
 */
class BizError extends Error {
  constructor(message, { code = 1, httpStatus = 400 } = {}) {
    super(message);
    this.name = 'BizError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** 常用工厂 */
BizError.unauthorized = (message = '未登录或登陆已过期') =>
  new BizError(message, { code: 401, httpStatus: 401 });
BizError.forbidden = (message = '无权访问') =>
  new BizError(message, { code: 403, httpStatus: 403 });
BizError.notFound = (message = '资源不存在') =>
  new BizError(message, { code: 404, httpStatus: 404 });
BizError.badRequest = (message = '请求参数错误') =>
  new BizError(message, { code: 400, httpStatus: 400 });
BizError.conflict = (message = '资源冲突') =>
  new BizError(message, { code: 409, httpStatus: 409 });

const responseMiddleware = async (ctx, next) => {
  ctx.success = (data = null, message = 'ok') => {
    ctx.status = 200;
    ctx.body = { code: 0, message, data };
  };

  ctx.fail = (message, code = 1, httpStatus = 400) => {
    ctx.status = httpStatus;
    ctx.body = { code, message, data: null };
  };

  await next();
};

module.exports = { responseMiddleware, BizError };
