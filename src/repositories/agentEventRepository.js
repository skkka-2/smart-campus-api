// agent_events 表的 repository。
// P3-2 会话可回放：把 agent 执行的所有事件落库，前端可按 seq 重放。
// 学自 pi 的 SessionEntry 事件树（最小版：单线性 seq，不做 parentId 树/fork）。
const { db } = require('../db');

const agentEventRepository = {
  /**
  /**
   * 追加一条事件。seq 由 repository 自己算（MAX(seq)+1），不信任调用方传入——
   * 之前 runner 每请求从 0 开始，导致同 session 第二轮撞 uk_session_seq 唯一索引。
   * 唯一索引仍保留做兜底；冲突时 catch 住重算一次。
   */
  async append({ sessionId, userId, type, payload }) {
    const [[maxRow]] = await db.query(
      'SELECT COALESCE(MAX(seq), 0) AS m FROM agent_events WHERE session_id = ?',
      [sessionId],
    );
    const seq = (maxRow?.m || 0) + 1;
    const [res] = await db.query(
      `INSERT INTO agent_events (session_id, user_id, seq, type, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, String(userId), seq, type, JSON.stringify(payload)],
    );
    return res.insertId;
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
