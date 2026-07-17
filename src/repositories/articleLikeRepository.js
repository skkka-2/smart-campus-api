const { db } = require('../db');

const articleLikeRepository = {
  /** 用户对文章是否已点赞 */
  async exists({ articleId, userId }) {
    const [rows] = await db.query(
      'SELECT id FROM article_like WHERE article_id = ? AND user_id = ? LIMIT 1',
      [articleId, userId],
    );
    return rows.length > 0;
  },

  /** 点赞;已存在则忽略 */
  async create({ articleId, userId }) {
    await db.query(
      'INSERT IGNORE INTO article_like (article_id, user_id) VALUES (?, ?)',
      [articleId, userId],
    );
  },

  /** 取消点赞 */
  async remove({ articleId, userId }) {
    await db.query(
      'DELETE FROM article_like WHERE article_id = ? AND user_id = ?',
      [articleId, userId],
    );
  },

  /** 某文章总点赞数 */
  async countByArticle(articleId) {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS n FROM article_like WHERE article_id = ?',
      [articleId],
    );
    return rows[0].n;
  },
};

module.exports = articleLikeRepository;
