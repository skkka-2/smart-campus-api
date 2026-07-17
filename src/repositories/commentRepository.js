const { db } = require('../db');

const commentRepository = {
  /** 兼容旧接口:按用户名查评论 */
  async findByUsername(userName) {
    const [rows] = await db.query(
      'SELECT id, article_id, userName, content, `like`, time, created_at FROM comment WHERE userName = ? ORDER BY id DESC',
      [userName],
    );
    return rows;
  },

  /** 分页拉所有评论 */
  async list({ offset = 0, limit = 20 } = {}) {
    const [rows] = await db.query(
      'SELECT id, article_id, userName, content, `like`, time, created_at FROM comment ORDER BY id DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );
    return rows;
  },

  /** 某文章下的评论列表 */
  async listByArticle(articleId, { offset = 0, limit = 20 } = {}) {
    const [rows] = await db.query(
      `SELECT id, article_id, user_id, userName, content, \`like\`, time, created_at
         FROM comment
         WHERE article_id = ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      [articleId, limit, offset],
    );
    return rows;
  },

  async countByArticle(articleId) {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS n FROM comment WHERE article_id = ?',
      [articleId],
    );
    return rows[0].n;
  },

  /** 新增评论(article_id 可选,兼容旧接口) */
  async create({ articleId = null, userId = null, userName, content, like = 0, time = Date.now() } = {}) {
    const [res] = await db.query(
      'INSERT INTO comment (article_id, user_id, userName, content, `like`, time) VALUES (?, ?, ?, ?, ?, ?)',
      [articleId, userId, userName, content, like, time],
    );
    return res.insertId;
  },
};

module.exports = commentRepository;
