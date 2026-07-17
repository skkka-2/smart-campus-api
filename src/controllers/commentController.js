const commentService = require('../services/commentService');
const { parsePagination } = require('../utils/pagination');
const { BizError } = require('../utils/response');

const commentController = {
  /** POST /api/comments/query  body: { userName }  兼容旧接口 */
  async listByUsername(ctx) {
    const { userName } = ctx.request.body || {};
    const items = await commentService.listByUsername(userName);
    ctx.success(items);
  },

  /** GET /api/comments?page=1&limit=20 */
  async list(ctx) {
    const { offset, limit } = parsePagination(ctx.query, 20);
    const items = await commentService.list({ offset, limit });
    ctx.success({ items });
  },

  /** GET /api/articles/:articleId/comments */
  async listByArticle(ctx) {
    const articleId = Number(ctx.params.articleId);
    if (!Number.isFinite(articleId)) throw BizError.badRequest('无效的文章 id');
    const { offset, limit, page } = parsePagination(ctx.query, 20);
    const data = await commentService.listByArticle({ articleId, offset, limit });
    ctx.success({ ...data, page, limit });
  },

  /** POST /api/articles/:articleId/comments  body: { content } */
  async createOnArticle(ctx) {
    const articleId = Number(ctx.params.articleId);
    if (!Number.isFinite(articleId)) throw BizError.badRequest('无效的文章 id');
    const { content } = ctx.request.body || {};
    const data = await commentService.create({
      articleId,
      userId: ctx.state.user.id,
      userName: ctx.state.user.username,
      content,
    });
    ctx.success(data, '评论成功');
  },

  /** POST /api/comments  body: { content } —— 独立评论(无文章绑定) */
  async create(ctx) {
    const { content } = ctx.request.body || {};
    const data = await commentService.create({
      userId: ctx.state.user.id,
      userName: ctx.state.user.username,
      content,
    });
    ctx.success(data, '评论成功');
  },
};

module.exports = commentController;
