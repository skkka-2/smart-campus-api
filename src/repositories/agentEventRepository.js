// agent_events 表的 repository。
// P3-2 会话可回放：把 agent 执行的所有事件落库，前端可按 seq 重放。
// 学自 pi 的 SessionEntry 事件树（最小版：单线性 seq，不做 parentId 树/fork）。
const crypto = require('node:crypto');
const { db } = require('../db');

function eventLockName(sessionId) {
  // MySQL named lock 名称最长 64 字节，hash 后固定为 64 个 ASCII 字符。
  return crypto.createHash('sha256').update(String(sessionId)).digest('hex');
}

const agentEventRepository = {
  /**
   * 追加一条事件。通过 MySQL session lock 串行化同一 session 的 seq 分配，
   * 避免并发 MAX(seq)+1 得到相同 seq。
   */
  async append({ sessionId, userId, type, payload }) {
    const connection = await db.getConnection();
    const lockName = eventLockName(sessionId);
    let lockAcquired = false;
    let transactionStarted = false;

    try {
      const [[lockRow]] = await connection.query(
        'SELECT GET_LOCK(?, 10) AS acquired',
        [lockName],
      );
      if (Number(lockRow?.acquired) !== 1) {
        throw new Error(`failed to acquire agent event lock for session ${sessionId}`);
      }
      lockAcquired = true;

      await connection.beginTransaction();
      transactionStarted = true;
      const [[maxRow]] = await connection.query(
        'SELECT COALESCE(MAX(seq), 0) AS m FROM agent_events WHERE session_id = ?',
        [sessionId],
      );
      const seq = Number(maxRow?.m || 0) + 1;
      const [res] = await connection.query(
        `INSERT INTO agent_events (session_id, user_id, seq, type, payload)
         VALUES (?, ?, ?, ?, ?)`,
        [sessionId, String(userId), seq, type, JSON.stringify(payload)],
      );
      await connection.commit();
      transactionStarted = false;
      return res.insertId;
    } catch (err) {
      if (transactionStarted) {
        await connection.rollback().catch(() => {});
      }
      throw err;
    } finally {
      if (lockAcquired) {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
      }
      connection.release();
    }
  },

  /** 按 seq 正序拉某会话的全部事件（回放用） */
  async listBySession(userId, sessionId) {
    const [rows] = await db.query(
      `SELECT id, session_id, user_id, seq, type, payload, created_at
         FROM agent_events
        WHERE user_id = ? AND session_id = ?
        ORDER BY seq ASC`,
      [String(userId), sessionId],
    );
    return rows.map((r) => {
      let payload = r.payload;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { payload = null; }
      }
      return { ...r, payload };
    });
  },

  /** 列出某用户的会话（聚合，按最后活动时间倒序） */
  async listSessions(userId) {
    const [rows] = await db.query(
      `SELECT session_id, MAX(seq) AS last_seq, COUNT(*) AS event_count,
              MIN(created_at) AS started_at, MAX(created_at) AS last_active_at
         FROM agent_events
        WHERE user_id = ?
        GROUP BY session_id
        ORDER BY last_active_at DESC`,
      [String(userId)],
    );
    return rows;
  },

  /** 清空某会话事件 */
  async clearBySession(userId, sessionId) {
    const [res] = await db.query(
      'DELETE FROM agent_events WHERE user_id = ? AND session_id = ?',
      [String(userId), sessionId],
    );
    return res.affectedRows;
  },

  /** 清空某用户全部事件（清空历史时一起删 agent_events） */
  async clearByUser(userId) {
    const [res] = await db.query('DELETE FROM agent_events WHERE user_id = ?', [String(userId)]);
    return res.affectedRows;
  },
};

module.exports = agentEventRepository;
