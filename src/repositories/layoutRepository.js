const { db } = require('../db');

/** 首页右侧三个榜单 */
const layoutRepository = {
  async fetchRankings() {
    const [rows] = await db.query('SELECT bang1, bang2, bang3 FROM layoutlist');
    return {
      articles: rows.map((r) => r.bang1).filter(Boolean),
      authors: rows.map((r) => r.bang2).filter(Boolean),
      topics: rows.map((r) => r.bang3).filter(Boolean),
    };
  },
};

module.exports = layoutRepository;
