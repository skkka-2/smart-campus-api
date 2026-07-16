/**
 * 分页参数解析
 * @param {object} query
 * @param {number} defaultLimit
 * @returns {{ page: number, limit: number, offset: number }}
 */
function parsePagination(query = {}, defaultLimit = 10) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { parsePagination };
