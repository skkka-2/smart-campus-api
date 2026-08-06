const { db } = require('../db');

function mapFriend(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    requesterId: String(row.requester_id),
    addresseeId: String(row.addressee_id),
    pairLow: String(row.pair_low),
    pairHigh: String(row.pair_high),
    status: row.status,
    remark: row.remark,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    user:
      row.user_id == null
        ? null
        : {
            id: String(row.user_id),
            username: row.username,
            avatarUrl: row.avatar_url,
          },
  };
}

const chatFriendRepository = {
  async findByPair(pairLow, pairHigh, connection = db, forUpdate = false) {
    const [rows] = await connection.query(
      `SELECT id, requester_id, addressee_id, pair_low, pair_high, status, remark,
              created_at, updated_at
         FROM chat_friendships
        WHERE pair_low = ? AND pair_high = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [pairLow, pairHigh],
    );
    return rows[0] || null;
  },

  async findById(id, connection = db, forUpdate = false) {
    const [rows] = await connection.query(
      `SELECT id, requester_id, addressee_id, pair_low, pair_high, status, remark,
              created_at, updated_at
         FROM chat_friendships
        WHERE id = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] || null;
  },

  async insert({ requesterId, addresseeId, pairLow, pairHigh, remark }, connection = db) {
    const [result] = await connection.query(
      `INSERT INTO chat_friendships
        (requester_id, addressee_id, pair_low, pair_high, status, remark)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [requesterId, addresseeId, pairLow, pairHigh, remark || null],
    );
    return result.insertId;
  },

  async updateStatus(id, status, patch = {}, connection = db) {
    await connection.query(
      `UPDATE chat_friendships
          SET status = ?,
              requester_id = COALESCE(?, requester_id),
              addressee_id = COALESCE(?, addressee_id),
              remark = COALESCE(?, remark),
              updated_at = NOW()
        WHERE id = ?`,
      [status, patch.requesterId ?? null, patch.addresseeId ?? null, patch.remark ?? null, id],
    );
  },

  async listFriends(userId) {
    const [rows] = await db.query(
      `SELECT f.id, f.requester_id, f.addressee_id, f.pair_low, f.pair_high,
              f.status, f.remark, f.created_at, f.updated_at,
              u.id AS user_id, u.username, u.avatar_url
         FROM chat_friendships f
         JOIN userlist u
           ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
        WHERE f.status = 'accepted'
          AND (f.requester_id = ? OR f.addressee_id = ?)
        ORDER BY f.updated_at DESC, f.id DESC`,
      [userId, userId, userId],
    );
    return rows.map(mapFriend);
  },

  async listRequests(userId, direction = 'incoming') {
    const incoming = direction !== 'outgoing';
    const field = incoming ? 'addressee_id' : 'requester_id';
    const [rows] = await db.query(
      `SELECT f.id, f.requester_id, f.addressee_id, f.pair_low, f.pair_high,
              f.status, f.remark, f.created_at, f.updated_at,
              u.id AS user_id, u.username, u.avatar_url
         FROM chat_friendships f
         JOIN userlist u
           ON u.id = CASE WHEN f.${field} = ? THEN f.${incoming ? 'requester_id' : 'addressee_id'} END
        WHERE f.${field} = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC, f.id DESC`,
      [userId, userId],
    );
    return rows.map(mapFriend);
  },

  async deletePair(pairLow, pairHigh, userId) {
    const [result] = await db.query(
      `DELETE FROM chat_friendships
        WHERE pair_low = ? AND pair_high = ?
          AND (requester_id = ? OR addressee_id = ?)`,
      [pairLow, pairHigh, userId, userId],
    );
    return result.affectedRows > 0;
  },
};

module.exports = { chatFriendRepository, mapFriend };
