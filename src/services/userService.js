const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');
const { sign } = require('../utils/jwt');
const { BizError } = require('../utils/response');

const BCRYPT_ROUNDS = 10;

const userService = {
  /** 注册 */
  async register({ username, password, phone } = {}) {
    if (!username || !password || !phone) {
      throw BizError.badRequest('用户名、密码、手机号均不能为空');
    }

    if (await userRepository.findByUsername(username)) {
      throw BizError.conflict('用户名已被占用');
    }
    if (await userRepository.findByPhone(phone)) {
      throw BizError.conflict('该手机号已注册');
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = await userRepository.create({ username, password: hashed, phone });
    return { id, username, phone };
  },

  /** 登录 */
  async login({ username, password } = {}) {
    if (!username || !password) throw BizError.badRequest('账号或密码不能为空');

    const user = await userRepository.findByUsername(username);
    if (!user) throw BizError.notFound('用户不存在');

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw BizError.unauthorized('密码错误');

    const token = sign({ id: user.id, username: user.username });
    return {
      token: `Bearer ${token}`,
      user: { id: user.id, username: user.username },
    };
  },

  async profile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw BizError.notFound('用户不存在');
    return user;
  },
};

module.exports = userService;
