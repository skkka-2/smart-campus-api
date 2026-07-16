const articleRepository = require('../repositories/articleRepository');
const layoutRepository = require('../repositories/layoutRepository');
const { BizError } = require('../utils/response');

const articleService = {
  /** 首页信息流分页 */
  async listArticles({ sortType, page, limit, offset } = {}) {
    const [items, total] = await Promise.all([
      articleRepository.list({ sortType, offset, limit }),
      articleRepository.count({ sortType }),
    ]);
    return {
      items,
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    };
  },

  /** 创建文章 */
  async createArticle({ content, user } = {}) {
    if (!content || !content.trim()) throw BizError.badRequest('文章内容不能为空');
    const id = await articleRepository.create({ cont: content, user });
    return { id };
  },

  /** 榜单 */
  async fetchRankings() {
    return layoutRepository.fetchRankings();
  },
};

module.exports = articleService;
