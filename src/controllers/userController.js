const userService = require('../services/userService');
const config = require('../config');

// 写 refresh token 到 httpOnly cookie
function setRefreshCookie(ctx, refreshToken, options) {
  ctx.cookies.set(config.jwt.refreshCookieName, refreshToken, options);
}

// 读 refresh token cookie（Koa2 的 ctx.cookies 是对象，要用 get）
function getRefreshCookie(ctx) {
  return ctx.cookies?.get(config.jwt.refreshCookieName) || null;
}

const userController = {
  async register(ctx) {
    const { username, password, phone } = ctx.request.body || {};
    const user = await userService.register({ username, password, phone });
    ctx.success(user, '注册成功');
  },

  async login(ctx) {
    const { username, password } = ctx.request.body || {};
    const data = await userService.login({ username, password });
    // refresh token 写 httpOnly cookie（JS 读不到，防 XSS）
    setRefreshCookie(ctx, data.refreshToken, data.refreshCookieOptions);
    // 返回给前端的只有 access token + user（refresh 不暴露给 JS）
    ctx.success({ token: data.token, user: data.user }, '登录成功');
  },

  /** POST /api/users/refresh —— access 过期时前端用它换新的 */
  async refresh(ctx) {
    const refreshToken = getRefreshCookie(ctx);
    const data = await userService.refresh(refreshToken);
    setRefreshCookie(ctx, data.refreshToken, data.refreshCookieOptions);
    ctx.success({ token: data.token }, '已刷新');
  },

  /** POST /api/users/logout —— 撤销 refresh token + 清 cookie */
  async logout(ctx) {
    const refreshToken = getRefreshCookie(ctx);
    await userService.logout(refreshToken);
    ctx.cookies.set(config.jwt.refreshCookieName, '', { expires: new Date(0), path: '/api/users' });
    ctx.success(null, '已登出');
  },

  /** POST /api/users/me/password —— 改密（需旧密码） */
  async changePassword(ctx) {
    const { oldPassword, newPassword } = ctx.request.body || {};
    await userService.changePassword(ctx.state.user.id, { oldPassword, newPassword });
    // 改密后 refresh 全失效，清 cookie（前端要跳登录）
    ctx.cookies.set(config.jwt.refreshCookieName, '', { expires: new Date(0), path: '/api/users' });
    ctx.success(null, '密码已修改，请重新登录');
  },

  async me(ctx) {
    const user = await userService.profile(ctx.state.user.id);
    ctx.success(user);
  },

  /** GET /api/users/me/profile 完整画像 */
  async getProfile(ctx) {
    const profile = await userService.getProfile(ctx.state.user.id);
    ctx.success(profile);
  },

  /** PUT /api/users/me/profile 更新画像 */
  async updateProfile(ctx) {
    const patch = ctx.request.body || {};
    const profile = await userService.updateProfile(ctx.state.user.id, patch);
    ctx.success(profile, '已更新');
  },
};

module.exports = userController;
