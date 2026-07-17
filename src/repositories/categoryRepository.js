const { db } = require('../db');

const CATEGORY_FIELDS = 'id, name, slug, icon, sort_order';

const categoryRepository = {
  async list() {
    const [rows] = await db.query(
      `SELECT ${CATEGORY_FIELDS} FROM category ORDER BY sort_order ASC, id ASC`,
    );
    return rows;
  },

  async findBySlug(slug) {
    const [rows] = await db.query(
      `SELECT ${CATEGORY_FIELDS} FROM category WHERE slug = ? LIMIT 1`,
      [slug],
    );
    return rows[0] || null;
  },
};

module.exports = categoryRepository;
