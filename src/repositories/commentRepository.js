const { db } = require('../db');

const commentRepository = {
  /** 按 userName 查该用户的所有评论(兼容旧接口) */
  async findByUsername(userName) {
    const [rows] = await db.query(
      'SELECT id, userName, content, `like`, time, created_at FROM comment WHERE userName = ? ORDER BY id DESC',
      [userName],
    );
    return rows;
  },

  /** 拉取全部评论(分页) */
  async list({ offset = 0, limit = 20 } = {}) {
    const [rows] = await db.query(
      'SELECT id, userName, content, `like`, time, created_at FROM comment ORDER BY id DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );
    return rows;
  },

  /** 新增评论 */
  async create({ userName, content, like = 0, time = Date.now() } = {}) {
    const [res] = await db.query(
      'INSERT INTO comment (userName, content, `like`, time) VALUES (?, ?, ?, ?)',
      [userName, content, like, time],
    );
    return res.insertId;
  },
};

module.exports = commentRepository;
