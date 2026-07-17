const userService = require('../services/userService');

const userController = {
  async register(ctx) {
    const { username, password, phone } = ctx.request.body || {};
    const user = await userService.register({ username, password, phone });
    ctx.success(user, '注册成功');
  },

  async login(ctx) {
    const { username, password } = ctx.request.body || {};
    const data = await userService.login({ username, password });
    ctx.success(data, '登录成功');
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
