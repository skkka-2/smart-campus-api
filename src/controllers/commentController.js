const commentService = require('../services/commentService');
const { parsePagination } = require('../utils/pagination');

const commentController = {
  /** POST /api/comments/query  body: { userName } */
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

  /** POST /api/comments  body: { content } */
  async create(ctx) {
    const { content } = ctx.request.body || {};
    const userName = ctx.state.user.username;
    const data = await commentService.create({ userName, content });
    ctx.success(data, '评论成功');
  },
};

module.exports = commentController;
