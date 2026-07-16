const { db } = require('../db');

/** AI 对话历史 */
const chatMessageRepository = {
  /** 拉取某用户全部对话记录,时间正序 */
  async listByUser(userId) {
    const [rows] = await db.query(
      'SELECT id, user_id, type, text, timestamp FROM chatmessages WHERE user_id = ? ORDER BY timestamp ASC',
      [userId],
    );
    return rows;
  },

  async create({ userId, type, text } = {}) {
    const [res] = await db.query(
      'INSERT INTO chatmessages (user_id, type, text) VALUES (?, ?, ?)',
      [userId, type, text],
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
