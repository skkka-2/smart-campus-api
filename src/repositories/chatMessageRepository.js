const { db } = require('../db');

/** AI 对话历史 */
const chatMessageRepository = {
  /** 拉取某用户全部对话记录,时间正序 */
  async listByUser(userId) {
    const [rows] = await db.query(
      'SELECT id, user_id, session_id, type, text, timestamp, metadata FROM chatmessages WHERE user_id = ? ORDER BY timestamp ASC, id ASC',
      [userId],
    );
    // metadata 是 JSON,mysql2 会自动解析,但保护一下
    return rows.map((r) => {
      if (typeof r.metadata === 'string') {
        try { r.metadata = JSON.parse(r.metadata); } catch { r.metadata = null; }
      }
      return r;
    });
  },

  async create({ userId, type, text, sessionId = null, metadata = null } = {}) {
    const [res] = await db.query(
      'INSERT INTO chatmessages (user_id, session_id, type, text, metadata) VALUES (?, ?, ?, ?, ?)',
      [userId, sessionId, type, text, metadata ? JSON.stringify(metadata) : null],
    );
    return res.insertId;
  },

  /** 清空某用户全部对话,返回受影响行数 */
  async clearByUser(userId) {
    const [res] = await db.query('DELETE FROM chatmessages WHERE user_id = ?', [userId]);
    return res.affectedRows;
  },
};

module.exports = chatMessageRepository;
