const { db } = require('../db');

/**
 * 文章仓库
 * 兼容原始表结构:目前 recommendlist(推荐) + likelist(最新)是两张几乎一样的表,
 * Phase 3 会合并为单表,此层已按同一接口封装,业务层不感知底层差异。
 */

const ALLOWED_SORT_TABLES = { recommend: 'recommendlist', latest: 'likelist' };

/** 校验并返回真实表名,防 SQL 注入 */
function resolveTable(sortType) {
  const table = ALLOWED_SORT_TABLES[sortType];
  if (!table) throw new Error(`Unknown sort type: ${sortType}`);
  return table;
}

const articleRepository = {
  /** 分页拉取文章列表
   * @param {'recommend'|'latest'} sortType
   */
  async list({ sortType = 'recommend', offset = 0, limit = 10 } = {}) {
    const table = resolveTable(sortType);
    const [rows] = await db.query(
      `SELECT id, title, cont, picUrl, \`like\`, view, user, created_at
         FROM \`${table}\`
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    return rows;
  },

  /** 总条数,用于分页 hasMore 判断 */
  async count({ sortType = 'recommend' } = {}) {
    const table = resolveTable(sortType);
    const [rows] = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    return rows[0].n;
  },

  /** 用户上传文章,写入推荐表 */
  async create({ title = null, cont, picUrl = null, user = null } = {}) {
    const [res] = await db.query(
      'INSERT INTO recommendlist (title, cont, picUrl, `like`, view, user) VALUES (?, ?, ?, 0, "0", ?)',
      [title, cont, picUrl, user],
    );
    return res.insertId;
  },
};

module.exports = articleRepository;
