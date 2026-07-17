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

  /** 完整画像 */
  async getProfile(userId) {
    const profile = await userRepository.findProfileById(userId);
    if (!profile) throw BizError.notFound('用户不存在');
    return profile;
  },

  /** 更新画像 */
  async updateProfile(userId, patch = {}) {
    // 基本校验:字段合法值范围
    const GRADES = ['大一', '大二', '大三', '大四', '研一', '研二', '研三', '其他'];
    const DIRECTIONS = ['前端', '后端', '算法', '产品', '设计', '运营', '数据', '测试', '其他'];
    if (patch.grade && !GRADES.includes(patch.grade)) {
      throw BizError.badRequest('年级不合法');
    }
    if (patch.career_direction && !DIRECTIONS.includes(patch.career_direction)) {
      throw BizError.badRequest('职业方向不合法');
    }
    if (patch.interests && !Array.isArray(patch.interests)) {
      throw BizError.badRequest('兴趣必须是数组');
    }
    if (patch.bio && patch.bio.length > 200) {
      throw BizError.badRequest('个人简介不能超过 200 字');
    }
    await userRepository.updateProfile(userId, patch);
    return userRepository.findProfileById(userId);
  },
};

module.exports = userService;
