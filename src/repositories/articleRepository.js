const { db } = require('../db');

const LIST_FIELDS = `
  a.id, a.title, a.excerpt, a.cover_url, a.category_id,
  a.author_id, a.author_name,
  a.view_count, a.like_count, a.sort_type,
  a.created_at, c.name AS category_name, c.slug AS category_slug
`;

const DETAIL_FIELDS = `
  a.id, a.title, a.content, a.excerpt, a.cover_url, a.category_id,
  a.author_id, a.author_name,
  a.view_count, a.like_count, a.sort_type,
  a.created_at, a.updated_at,
  c.name AS category_name, c.slug AS category_slug
`;

/**
 * article 仓库
 * - list 支持按 sort_type / category_slug 过滤
 * - detail 单独一份 SELECT,包含 content 字段
 * - like 用 article_like 关系表,冗余更新 article.like_count 便于列表页快显示
 */

const articleRepository = {
  async list({ sortType, categorySlug, offset = 0, limit = 10 } = {}) {
    const where = [];
    const params = [];

    if (sortType && sortType !== 'all') {
      where.push('a.sort_type = ?');
      params.push(sortType);
    }
    if (categorySlug && categorySlug !== 'all') {
      where.push('c.slug = ?');
      params.push(categorySlug);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT ${LIST_FIELDS}
         FROM article a
         LEFT JOIN category c ON c.id = a.category_id
         ${whereSql}
         ORDER BY a.id DESC
         LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return rows;
  },

  async count({ sortType, categorySlug } = {}) {
    const where = [];
    const params = [];
    if (sortType && sortType !== 'all') {
      where.push('a.sort_type = ?');
      params.push(sortType);
    }
    if (categorySlug && categorySlug !== 'all') {
      where.push('c.slug = ?');
      params.push(categorySlug);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.query(
      `SELECT COUNT(*) AS n FROM article a LEFT JOIN category c ON c.id = a.category_id ${whereSql}`,
      params,
    );
    return rows[0].n;
  },

  async findById(id) {
    const [rows] = await db.query(
      `SELECT ${DETAIL_FIELDS} FROM article a LEFT JOIN category c ON c.id = a.category_id WHERE a.id = ? LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  },

  async incrementView(id) {
    await db.query('UPDATE article SET view_count = view_count + 1 WHERE id = ?', [id]);
  },

  async create({
    title = null,
    content,
    excerpt = null,
    coverUrl = null,
    categoryId = null,
    authorId = null,
    authorName = null,
    sortType = 'latest',
  } = {}) {
    const [res] = await db.query(
      `INSERT INTO article (title, content, excerpt, cover_url, category_id, author_id, author_name, sort_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, content, excerpt, coverUrl, categoryId, authorId, authorName, sortType],
    );
    return res.insertId;
  },

  /** 更新文章冗余 like_count(点赞/取消时同步) */
  async setLikeCount(id, count) {
    await db.query('UPDATE article SET like_count = ? WHERE id = ?', [count, id]);
  },
};

module.exports = articleRepository;
