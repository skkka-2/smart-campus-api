const Koa = require('koa2');
const bodyParser = require('koa-bodyparser');

const observability = require('./observability/instrumentation');
const config = require('./config');
const { verifyConnection } = require('./db');
const { responseMiddleware } = require('./utils/response');
const errorMiddleware = require('./middleware/error');
const loggerMiddleware = require('./middleware/logger');
const corsMiddleware = require('./middleware/cors');
const router = require('./routes');
const initWebSocket = require('./websocket');

async function bootstrap() {
  await observability.start();
  await verifyConnection();

  // 启动时校验：所有注册工具都必须在 safetyPolicy.TOOL_RISK 里登记风险等级，
  // 漏登记（新写工具忘了配确认）直接启动失败。fail fast at startup。
  const toolRegistry = require('./agent/toolRegistry');
  const { assertAllToolsClassified } = require('./agent/safetyPolicy');
  assertAllToolsClassified(toolRegistry.TOOLS.map((t) => t.name));

  // 登记密钥用于日志脱敏（学 openclaw secret-redaction-registry）。
  // 之后所有错误出口过 redactSecrets，防止 SDK error message 带 api_key 泄漏到日志/前端。
  const { registerSecret } = require('./observability/secretRedaction');
  if (config.openai.apiKey) registerSecret(config.openai.apiKey);

  const app = new Koa();

  app.use(errorMiddleware);            // 必须最外层,兜住所有 throw
  app.use(loggerMiddleware);
  app.use(corsMiddleware);
  app.use(bodyParser());
  app.use(responseMiddleware);         // 挂 ctx.success / ctx.fail
  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[app] server listening on http://localhost:${config.port}`);
  });

  initWebSocket(server);

  const shutdown = (signal) => {
    console.log(`[app] received ${signal}, shutting down`);
    server.close(async () => {
      await observability.shutdown();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[app] bootstrap failed:', err);
  process.exit(1);
});
