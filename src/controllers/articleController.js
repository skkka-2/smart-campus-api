const articleService = require('../services/articleService');
const { parsePagination } = require('../utils/pagination');
const { BizError } = require('../utils/response');

const articleController = {
  /**
   * GET /api/articles?sort=recommend|latest|all&category=<slug>&page=1&limit=5
   */
  async list(ctx) {
    const { page, limit, offset } = parsePagination(ctx.query, 5);
    const sortType = ['recommend', 'latest', 'all'].includes(ctx.query.sort)
      ? ctx.query.sort
      : 'recommend';
    const categorySlug = ctx.query.category || 'all';
    const data = await articleService.listArticles({
      sortType,
      categorySlug,
      page,
      limit,
      offset,
    });
    ctx.success(data);
  },

  /**
   * GET /api/articles/rankings
   */
  async rankings(ctx) {
    const data = await articleService.fetchRankings();
    ctx.success(data);
  },

  /**
   * GET /api/articles/:id
   */
  async detail(ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) throw BizError.badRequest('无效的文章 id');
    const userId = ctx.state.user?.id;
    const data = await articleService.getArticleDetail({ id, userId });
    ctx.success(data);
  },

  /**
   * POST /api/articles
   */
  async create(ctx) {
    const { content, title, categoryId } = ctx.request.body || {};
    const data = await articleService.createArticle({
      content,
      title,
      categoryId,
      authorId: ctx.state.user.id,
      authorName: ctx.state.user.username,
    });
    ctx.success(data, '发布成功');
  },

  /**
   * POST /api/articles/:id/like  — 切换点赞
   */
  async toggleLike(ctx) {
    const articleId = Number(ctx.params.id);
    if (!Number.isFinite(articleId)) throw BizError.badRequest('无效的文章 id');
    const data = await articleService.toggleLike({
      articleId,
      userId: ctx.state.user.id,
    });
    ctx.success(data);
  },
};

module.exports = articleController;
