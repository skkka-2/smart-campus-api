const { verify, extractFromHeader } = require('../utils/jwt');
const { BizError } = require('../utils/response');

/**
 * 要求登录:token 无效则抛 401,成功则把 payload 挂到 ctx.state.user
 * 用法(per-route):
 *   router.post('/articles', requireAuth, controller.create)
 */
const requireAuth = async (ctx, next) => {
  const token = extractFromHeader(ctx.headers.authorization);
  if (!token) throw BizError.unauthorized('未登录,请先登录');

  const payload = verify(token); // 失败会抛,由 error 中间件处理
  ctx.state.user = payload;
  await next();
};

/**
 * 可选登录:有 token 就解析、无就跳过
 * 用于公开接口但想知道调用方是谁(比如首页可标记"已点赞")
 */
const optionalAuth = async (ctx, next) => {
  const token = extractFromHeader(ctx.headers.authorization);
  if (token) {
    try {
      ctx.state.user = verify(token);
    } catch {
      // 静默:可选登录不阻断
    }
  }
  await next();
};

module.exports = { requireAuth, optionalAuth };
