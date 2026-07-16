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
};

module.exports = userController;
