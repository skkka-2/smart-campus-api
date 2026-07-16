const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-do-not-use-in-prod';

const checkToken = async (ctx, next) => {
  // 跳过登录/注册
  if (ctx.url === '/user/login' || ctx.url === '/user/register') {
    return next();
  }

  const token = ctx.headers['authorization'];
  if (!token) {
    ctx.status = 401;
    ctx.body = { message: '登录失败，请重新登录！' };
    return;
  }

  const tokenValue = token.split(' ')[1];

  try {
    const decoded = jwt.verify(tokenValue, JWT_SECRET);
    ctx.state.user = decoded;
    await next();
  } catch (err) {
    ctx.status = 401;
    ctx.body = { message: '登陆过期，请重新登录！' };
  }
};

module.exports = checkToken;
