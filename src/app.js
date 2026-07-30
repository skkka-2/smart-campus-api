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
