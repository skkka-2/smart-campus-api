const articleRepository = require('../repositories/articleRepository');
const articleLikeRepository = require('../repositories/articleLikeRepository');
const layoutRepository = require('../repositories/layoutRepository');
const { BizError } = require('../utils/response');

const articleService = {
  /**
   * 分页拉文章
   *   sortType: 'recommend' | 'latest' | 'all'
   *   categorySlug: 'campus' | 'grad' | ... | 'all'
   */
  async listArticles({ sortType, categorySlug, page, limit, offset } = {}) {
    const [items, total] = await Promise.all([
      articleRepository.list({ sortType, categorySlug, offset, limit }),
      articleRepository.count({ sortType, categorySlug }),
    ]);
    return {
      items,
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    };
  },

  /**
   * 文章详情;登录用户会附带 liked 标记
   *   触发一次 view_count +1(异步)
   */
  async getArticleDetail({ id, userId } = {}) {
    const article = await articleRepository.findById(id);
    if (!article) throw BizError.notFound('文章不存在');

    // 异步 +1 view,不 block 详情返回
    articleRepository.incrementView(id).catch((err) =>
      console.error('[articleService] increment view failed:', err.message),
    );

    let liked = false;
    if (userId) {
      liked = await articleLikeRepository.exists({ articleId: id, userId });
    }

    return { article, liked };
  },

  /** 创建文章 */
  async createArticle({ content, title, categoryId, authorId, authorName } = {}) {
    if (!content || !content.trim()) throw BizError.badRequest('文章内容不能为空');

    // excerpt 从 content 里去 HTML 后取前 120 字
    const plain = content.replace(/<[^>]+>/g, '').trim();
    const excerpt = plain.length > 120 ? `${plain.slice(0, 120)}...` : plain;

    const id = await articleRepository.create({
      title: title || plain.slice(0, 40) || '无题',
      content,
      excerpt,
      categoryId,
      authorId,
      authorName,
      sortType: 'latest',
    });
    return { id };
  },

  /** 切换点赞;返回最新状态 */
  async toggleLike({ articleId, userId } = {}) {
    if (!userId) throw BizError.unauthorized('请先登录');

    const article = await articleRepository.findById(articleId);
    if (!article) throw BizError.notFound('文章不存在');

    const already = await articleLikeRepository.exists({ articleId, userId });
    if (already) {
      await articleLikeRepository.remove({ articleId, userId });
    } else {
      await articleLikeRepository.create({ articleId, userId });
    }

    const likeCount = await articleLikeRepository.countByArticle(articleId);
    await articleRepository.setLikeCount(articleId, likeCount);

    return { liked: !already, likeCount };
  },

  /** 榜单 */
  async fetchRankings() {
    return layoutRepository.fetchRankings();
  },
};

module.exports = articleService;
