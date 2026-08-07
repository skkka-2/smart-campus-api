const { db } = require('../db');

/** 首页右侧三个榜单,优先从文章实时聚合,旧 layoutlist 只作兼容兜底。 */
const layoutRepository = {
  async fetchRankings() {
    const [articleRows] = await db.query(
      `SELECT title
         FROM article
        WHERE title IS NOT NULL AND title <> ''
        ORDER BY (like_count * 4 + view_count) DESC, created_at DESC, id DESC
        LIMIT 5`,
    );
    const [authorRows] = await db.query(
      `SELECT author_name, SUM(like_count) AS likes, COUNT(*) AS article_count
         FROM article
        WHERE author_name IS NOT NULL AND author_name <> ''
        GROUP BY author_name
        ORDER BY likes DESC, article_count DESC, author_name ASC
        LIMIT 5`,
    );
    const [topicRows] = await db.query(
      `SELECT c.name, COUNT(a.id) AS article_count
         FROM article a
         JOIN category c ON c.id = a.category_id
        WHERE c.slug <> 'all' AND c.slug <> 'focus'
        GROUP BY c.id, c.name
        ORDER BY article_count DESC, c.sort_order ASC
        LIMIT 5`,
    );
    const [fallbackRows] = await db.query('SELECT bang1, bang2, bang3 FROM layoutlist');

    const fallback = {
      articles: fallbackRows.map((r) => r.bang1).filter(Boolean),
      authors: fallbackRows.map((r) => r.bang2).filter(Boolean),
      topics: fallbackRows.map((r) => r.bang3).filter(Boolean),
    };

    return {
      articles: articleRows.map((r) => r.title).filter(Boolean).length
        ? articleRows.map((r) => r.title).filter(Boolean)
        : fallback.articles,
      authors: authorRows.map((r) => r.author_name).filter(Boolean).length
        ? authorRows.map((r) => r.author_name).filter(Boolean)
        : fallback.authors,
      topics: topicRows.map((r) => `#${r.name}`).filter(Boolean).length
        ? topicRows.map((r) => `#${r.name}`).filter(Boolean)
        : fallback.topics,
    };
  },
};

module.exports = layoutRepository;
