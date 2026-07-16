const commentRepository = require('../repositories/commentRepository');
const { BizError } = require('../utils/response');

const commentService = {
  /** 按用户名查评论 */
  async listByUsername(userName) {
    if (!userName) throw BizError.badRequest('缺少 userName');
    return commentRepository.findByUsername(userName);
  },

  /** 分页拉全部评论 */
  async list({ offset, limit } = {}) {
    return commentRepository.list({ offset, limit });
  },

  /** 新增评论 */
  async create({ userName, content } = {}) {
    if (!userName || !content) throw BizError.badRequest('userName 和 content 都不能为空');
    const id = await commentRepository.create({ userName, content });
    return { id };
  },
};

module.exports = commentService;
