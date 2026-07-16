require('dotenv').config();

const koa = require('koa2');
const cors = require('koa2-cors');
const bodyParser = require('koa-bodyparser');
const router = require('./router/index');
const checkToken = require('./middle/checkToken');
const initWebSocket = require('./websocket');

const app = new koa();
const PORT = Number(process.env.PORT) || 3007;

app.use(cors());
app.use(bodyParser());
app.use(checkToken);
app.use(router.routes(), router.allowedMethods());

// 请求日志
app.use(async (ctx, next) => {
  console.log(`[${new Date().toISOString()}] ${ctx.method} ${ctx.url}`);
  await next();
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

initWebSocket(server);
