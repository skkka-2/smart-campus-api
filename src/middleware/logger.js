/**
 * 请求日志中间件——打印 method、path、status、耗时
 */
const loggerMiddleware = async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`[req] ${ctx.method} ${ctx.url} → ${ctx.status} (${ms}ms)`);
};

module.exports = loggerMiddleware;
