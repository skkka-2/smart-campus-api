const commentRepository = require('../repositories/commentRepository');
const { BizError } = require('../utils/response');

const commentService = {
  async listByUsername(userName) {
    if (!userName) throw BizError.badRequest('缺少 userName');
    return commentRepository.findByUsername(userName);
  },

  async list({ offset, limit } = {}) {
    return commentRepository.list({ offset, limit });
  },

  async listByArticle({ articleId, offset, limit } = {}) {
    const [items, total] = await Promise.all([
      commentRepository.listByArticle(articleId, { offset, limit }),
      commentRepository.countByArticle(articleId),
    ]);
    return { items, total };
  },

  async create({ articleId, userId, userName, content } = {}) {
    if (!userName) throw BizError.badRequest('缺少作者信息');
    if (!content || !content.trim()) throw BizError.badRequest('评论不能为空');
    const id = await commentRepository.create({
      articleId,
      userId,
      userName,
      content: content.trim(),
      time: Date.now(),
    });
    return { id };
  },
};

module.exports = commentService;
