const { db } = require('../db');

/** 聊天室历史消息 */
const messageRepository = {
  /** 最新 N 条,返回时按时间正序(便于前端直接渲染) */
  async latest(limit = 10) {
    const [rows] = await db.query(
      'SELECT id, sender_id, receiver_id, content, created_at FROM message ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows.reverse();
  },

  /** 插入一条聊天消息 */
  async create({ senderId, receiverId, content, createdAt } = {}) {
    const [res] = await db.query(
      'INSERT INTO message (sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, ?)',
      [senderId, receiverId, content, createdAt],
    );
    return res.insertId;
  },
};

module.exports = messageRepository;
