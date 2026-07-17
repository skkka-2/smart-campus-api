const { db } = require('../db');

/**
 * job 仓库
 * 字段(见 schema.sql):id/title/company/company_logo/company_size/industry/city/
 * work_type/category/salary_min/max/display/degree_required/experience_required/
 * description/requirements(JSON)/benefits(JSON)/tags(JSON)/source_url/
 * view_count/apply_count/is_hot/is_urgent/created_at/expired_at
 */

const CARD_FIELDS = `
  id, title, company, company_logo, company_size, industry, city,
  work_type, category, salary_min, salary_max, salary_display,
  degree_required, experience_required,
  tags, view_count, apply_count, is_hot, is_urgent, created_at
`;

const DETAIL_FIELDS = `
  ${CARD_FIELDS.replace(/,\s*$/, '')},
  description, requirements, benefits, source_url, expired_at
`;

/** parse JSON fields — mysql2 有时会自动解,有时不会,统一保护 */
function parseJsonFields(row) {
  if (!row) return row;
  for (const k of ['tags', 'requirements', 'benefits']) {
    if (typeof row[k] === 'string') {
      try { row[k] = JSON.parse(row[k]); } catch { row[k] = []; }
    }
    if (row[k] == null) row[k] = [];
  }
  return row;
}

const jobRepository = {
  /** 列表(带筛选) */
  async list({
    keyword, city, category, workType, degree, salaryMin,
    offset = 0, limit = 10, sort = 'default',
  } = {}) {
    const where = [];
    const params = [];

    if (keyword) {
      where.push('(title LIKE ? OR company LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (city) { where.push('city = ?'); params.push(city); }
    if (category) { where.push('category = ?'); params.push(category); }
    if (workType) { where.push('work_type = ?'); params.push(workType); }
    if (degree) { where.push('degree_required = ?'); params.push(degree); }
    if (salaryMin) { where.push('salary_min >= ?'); params.push(Number(salaryMin)); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let orderBy = 'is_urgent DESC, is_hot DESC, id DESC';
    if (sort === 'latest') orderBy = 'created_at DESC';
    else if (sort === 'salary') orderBy = 'salary_max DESC, salary_min DESC';
    else if (sort === 'hot') orderBy = 'view_count DESC';

    const [rows] = await db.query(
      `SELECT ${CARD_FIELDS} FROM job ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return rows.map(parseJsonFields);
  },

  async count(filters = {}) {
    const where = [];
    const params = [];
    if (filters.keyword) { where.push('(title LIKE ? OR company LIKE ?)'); params.push(`%${filters.keyword}%`, `%${filters.keyword}%`); }
    if (filters.city) { where.push('city = ?'); params.push(filters.city); }
    if (filters.category) { where.push('category = ?'); params.push(filters.category); }
    if (filters.workType) { where.push('work_type = ?'); params.push(filters.workType); }
    if (filters.degree) { where.push('degree_required = ?'); params.push(filters.degree); }
    if (filters.salaryMin) { where.push('salary_min >= ?'); params.push(Number(filters.salaryMin)); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.query(`SELECT COUNT(*) AS n FROM job ${whereSql}`, params);
    return rows[0].n;
  },

  async findById(id) {
    const [rows] = await db.query(
      `SELECT ${DETAIL_FIELDS} FROM job WHERE id = ? LIMIT 1`,
      [id],
    );
    return parseJsonFields(rows[0]) || null;
  },

  async incrementView(id) {
    await db.query('UPDATE job SET view_count = view_count + 1 WHERE id = ?', [id]);
  },

  async incrementApply(id) {
    await db.query('UPDATE job SET apply_count = apply_count + 1 WHERE id = ?', [id]);
  },

  /** 全部筛选选项(供前端筛选面板初始化) */
  async filterOptions() {
    const [cities] = await db.query(
      'SELECT city, COUNT(*) AS n FROM job GROUP BY city ORDER BY n DESC',
    );
    const [categories] = await db.query(
      'SELECT category, COUNT(*) AS n FROM job GROUP BY category ORDER BY n DESC',
    );
    const [degrees] = await db.query(
      'SELECT degree_required, COUNT(*) AS n FROM job GROUP BY degree_required ORDER BY n DESC',
    );
    return { cities, categories, degrees };
  },

  /** 用户偏好推荐 top N */
  async recommendForUser({ category, city, limit = 6 } = {}) {
    // 用简单加权 SQL 打分:同类别 +40,同城市 +20,is_hot +10
    const [rows] = await db.query(
      `SELECT ${CARD_FIELDS},
              (
                (CASE WHEN category = ? THEN 40 ELSE 0 END) +
                (CASE WHEN city = ? THEN 20 ELSE 0 END) +
                (CASE WHEN is_hot = 1 THEN 10 ELSE 0 END)
              ) AS score
         FROM job
         ORDER BY score DESC, view_count DESC
         LIMIT ?`,
      [category || '', city || '', limit],
    );
    return rows.map(parseJsonFields);
  },
};

module.exports = jobRepository;
