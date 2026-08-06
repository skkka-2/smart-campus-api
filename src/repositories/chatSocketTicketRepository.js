const { db } = require('../db');

const chatSocketTicketRepository = {
  async create({ userId, tokenHash, expiresAt }) {
    const [result] = await db.query(
      `INSERT INTO chat_socket_tickets (user_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [userId, tokenHash, expiresAt],
    );
    return result.insertId;
  },

  /**
   * 消费 ticket 必须在同一个事务里完成查询和标记，避免重连并发时一张票被使用两次。
   */
  async consume(tokenHash) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT id, user_id
           FROM chat_socket_tickets
          WHERE token_hash = ?
            AND used_at IS NULL
            AND expires_at > NOW()
          FOR UPDATE`,
        [tokenHash],
      );

      if (!rows.length) {
        await connection.rollback();
        return null;
      }

      await connection.query('UPDATE chat_socket_tickets SET used_at = NOW() WHERE id = ?', [
        rows[0].id,
      ]);
      await connection.commit();
      return rows[0];
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};

module.exports = chatSocketTicketRepository;
