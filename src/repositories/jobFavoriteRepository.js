const { db } = require('../db');

const jobFavoriteRepository = {
  async exists({ jobId, userId }) {
    const [rows] = await db.query(
      'SELECT id FROM job_favorite WHERE job_id = ? AND user_id = ? LIMIT 1',
      [jobId, userId],
    );
    return rows.length > 0;
  },

  async create({ jobId, userId }) {
    await db.query(
      'INSERT IGNORE INTO job_favorite (job_id, user_id) VALUES (?, ?)',
      [jobId, userId],
    );
  },

  async remove({ jobId, userId }) {
    await db.query(
      'DELETE FROM job_favorite WHERE job_id = ? AND user_id = ?',
      [jobId, userId],
    );
  },

  /** 我收藏的岗位 ids(供列表页附带 favorited 标记) */
  async listUserFavoriteIds(userId, jobIds) {
    if (!jobIds || jobIds.length === 0) return new Set();
    const placeholders = jobIds.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT job_id FROM job_favorite WHERE user_id = ? AND job_id IN (${placeholders})`,
      [userId, ...jobIds],
    );
    return new Set(rows.map((r) => r.job_id));
  },

  /** 分页返回用户收藏的完整岗位 */
  async listByUser(userId, { offset = 0, limit = 20 } = {}) {
    const [rows] = await db.query(
      `SELECT j.id, j.title, j.company, j.company_logo, j.company_size, j.industry, j.city,
              j.work_type, j.category, j.salary_display, j.degree_required,
              j.tags, j.view_count, j.apply_count, j.is_hot, j.is_urgent, j.created_at,
              f.created_at AS favorited_at
         FROM job_favorite f
         INNER JOIN job j ON j.id = f.job_id
         WHERE f.user_id = ?
         ORDER BY f.id DESC
         LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );
    return rows;
  },
};

module.exports = jobFavoriteRepository;
