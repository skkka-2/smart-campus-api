const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');
const { refreshTokenRepository } = require('../repositories/refreshTokenRepository');
const { signAccess } = require('../utils/jwt');
const { BizError } = require('../utils/response');
const config = require('../config');

const BCRYPT_ROUNDS = 10;

// refresh token cookie 配置
function refreshCookieOptions() {
  const opts = {
    httpOnly: true,   // JS 读不到，防 XSS 偷
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天，和 refreshExpiresIn 对齐
    sameSite: 'Lax',
    path: '/api/users',
  };
  if (config.jwt.cookieDomain) opts.domain = config.jwt.cookieDomain;
  if (config.jwt.secureCookie) opts.secure = true;
  return opts;
}

const userService = {
  /** 注册 */
  async register({ username, password, phone } = {}) {
    if (!username || !password || !phone) {
      throw BizError.badRequest('用户名、密码、手机号均不能为空');
    }
    if (username.length < 3 || username.length > 32) {
      throw BizError.badRequest('用户名长度需 3-32 字符');
    }
    if (password.length < 6) {
      throw BizError.badRequest('密码至少 6 位');
    }
    if (!/^1\d{10}$/.test(phone)) {
      throw BizError.badRequest('手机号格式不合法');
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

  /** 登录：返回 access token + user，refresh token 明文给 controller 写 cookie */
  async login({ username, password } = {}) {
    if (!username || !password) throw BizError.badRequest('账号或密码不能为空');

    const user = await userRepository.findByUsername(username);
    if (!user) throw BizError.notFound('用户不存在');

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw BizError.unauthorized('密码错误');

    const accessToken = signAccess({ id: user.id, username: user.username });
    const refreshToken = await refreshTokenRepository.issue(user.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return {
      token: `Bearer ${accessToken}`,
      refreshToken, // 明文，只此一次；controller 写进 httpOnly cookie
      refreshCookieOptions: refreshCookieOptions(),
      user: { id: user.id, username: user.username },
    };
  },

  /** 用 refresh token 换 access token（轮换：旧 refresh 撤销，签发新的） */
  async refresh(refreshToken) {
    const userId = await refreshTokenRepository.verify(refreshToken);
    if (!userId) throw BizError.unauthorized('refresh token 无效或已过期');

    await refreshTokenRepository.revoke(refreshToken); // 轮换防重放
    const user = await userRepository.findById(userId);
    if (!user) throw BizError.notFound('用户不存在');

    const accessToken = signAccess({ id: user.id, username: user.username });
    const newRefreshToken = await refreshTokenRepository.issue(user.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return {
      token: `Bearer ${accessToken}`,
      refreshToken: newRefreshToken,
      refreshCookieOptions: refreshCookieOptions(),
    };
  },

  /** 登出：撤销 refresh token */
  async logout(refreshToken) {
    if (refreshToken) await refreshTokenRepository.revoke(refreshToken);
  },

  /** 修改密码：验证旧密码 → 更新 → 撤销全部 refresh（其他设备掉线） */
  async changePassword(userId, { oldPassword, newPassword } = {}) {
    if (!oldPassword || !newPassword) throw BizError.badRequest('旧密码和新密码不能为空');
    if (newPassword.length < 6) throw BizError.badRequest('新密码至少 6 位');

    const user = await userRepository.findPasswordById(userId);
    if (!user) throw BizError.notFound('用户不存在');
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) throw BizError.unauthorized('旧密码错误');

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await userRepository.updatePassword(userId, hashed);
    // 改密后所有设备掉线（refresh 全部失效）
    await refreshTokenRepository.revokeAllForUser(userId);
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

  /** 上传头像：存文件 + 更新 avatar_url，返回新 URL */
  async uploadAvatar(userId, file) {
    if (!file) throw BizError.badRequest('缺少文件');
    // 校验类型和大小
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED.includes(file.mimetype)) {
      throw BizError.badRequest('仅支持 jpg/png/webp/gif');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw BizError.badRequest('图片不能超过 5MB');
    }
    const ext = (file.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const fs = require('fs');
    const buf = fs.readFileSync(file.path);
    const storage = require('../utils/storage');
    const { url } = await storage.saveAvatar(buf, ext);
    await userRepository.updateProfile(userId, { avatar_url: url });
    return { avatar_url: url };
  },
};

module.exports = userService;
