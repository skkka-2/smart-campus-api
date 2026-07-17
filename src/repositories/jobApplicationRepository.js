const { db } = require('../db');

const jobApplicationRepository = {
  async exists({ jobId, userId }) {
    const [rows] = await db.query(
      'SELECT id, status FROM job_application WHERE job_id = ? AND user_id = ? LIMIT 1',
      [jobId, userId],
    );
    return rows[0] || null;
  },

  async create({ jobId, userId, message }) {
    const [res] = await db.query(
      'INSERT INTO job_application (job_id, user_id, message) VALUES (?, ?, ?)',
      [jobId, userId, message || null],
    );
    return res.insertId;
  },

  /** 我的投递记录 */
  async listByUser(userId, { offset = 0, limit = 20 } = {}) {
    const [rows] = await db.query(
      `SELECT a.id, a.job_id, a.message, a.status, a.created_at,
              j.title, j.company, j.company_logo, j.city, j.salary_display, j.work_type, j.category
         FROM job_application a
         INNER JOIN job j ON j.id = a.job_id
         WHERE a.user_id = ?
         ORDER BY a.id DESC
         LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );
    return rows;
  },

  async listUserApplicationIds(userId, jobIds) {
    if (!jobIds || jobIds.length === 0) return new Map();
    const placeholders = jobIds.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT job_id, status FROM job_application WHERE user_id = ? AND job_id IN (${placeholders})`,
      [userId, ...jobIds],
    );
    return new Map(rows.map((r) => [r.job_id, r.status]));
  },
};

module.exports = jobApplicationRepository;
