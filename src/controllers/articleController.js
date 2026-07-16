const articleService = require('../services/articleService');
const { parsePagination } = require('../utils/pagination');

const articleController = {
  /** GET /api/articles?sort=recommend|latest&page=1&limit=5 */
  async list(ctx) {
    const { page, limit, offset } = parsePagination(ctx.query, 5);
    const sortType = ctx.query.sort === 'latest' ? 'latest' : 'recommend';
    const data = await articleService.listArticles({ sortType, page, limit, offset });
    ctx.success(data);
  },

  /** POST /api/articles */
  async create(ctx) {
    const { content } = ctx.request.body || {};
    const user = ctx.state.user?.username || null;
    const data = await articleService.createArticle({ content, user });
    ctx.success(data, '发布成功');
  },

  /** GET /api/rankings */
  async rankings(ctx) {
    const data = await articleService.fetchRankings();
    ctx.success(data);
  },
};

module.exports = articleController;
