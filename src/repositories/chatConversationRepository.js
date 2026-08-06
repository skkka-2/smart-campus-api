const { db } = require('../db');
const { HALL_KEY } = require('../chat/constants');

function mapConversation(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    type: row.type,
    name: row.name,
    avatarUrl: row.avatar_url,
    ownerId: row.owner_id == null ? null : String(row.owner_id),
    memberCount: Number(row.member_count || 0),
    lastMessage:
      row.last_message_id == null
        ? null
        : {
            id: String(row.last_message_id),
            type: row.last_message_type,
            content: parseJson(row.last_message_content),
            senderId: String(row.last_message_sender_id),
            sender:
              row.last_message_sender_username == null
                ? null
                : {
                    id: String(row.last_message_sender_id),
                    username: row.last_message_sender_username,
                    avatarUrl: row.last_message_sender_avatar_url,
                  },
            createdAt: toIso(row.last_message_created_at),
          },
    updatedAt: toIso(row.updated_at),
  };
}

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { text: String(value) };
  }
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const chatConversationRepository = {
  async ensureHall() {
    const [result] = await db.query(
      `INSERT INTO chat_conversations (type, hall_key, name)
       VALUES ('hall', ?, '校园实时论坛')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), status = 'active'`,
      [HALL_KEY],
    );
    return String(result.insertId);
  },

  async findById(conversationId, connection = db) {
    const [rows] = await connection.query(
      `SELECT id, type, hall_key, name, avatar_url, owner_id,
              direct_user_low, direct_user_high, status, updated_at
         FROM chat_conversations
        WHERE id = ?
        LIMIT 1`,
      [conversationId],
    );
    return rows[0] || null;
  },

  async findByIdForUser(conversationId, userId, connection = db) {
    const [rows] = await connection.query(
      `SELECT c.id, c.type, c.hall_key,
              COALESCE(c.name, direct_user.username) AS name,
              COALESCE(c.avatar_url, direct_user.avatar_url) AS avatar_url,
              c.owner_id, c.direct_user_low, c.direct_user_high,
              c.status, c.updated_at,
              COUNT(DISTINCT cm.user_id) AS member_count
         FROM chat_conversations c
         LEFT JOIN chat_conversation_members cm
           ON cm.conversation_id = c.id AND cm.status = 'active'
         LEFT JOIN userlist direct_user
           ON c.type = 'direct'
          AND direct_user.id = CASE
            WHEN c.direct_user_low = ? THEN c.direct_user_high
            ELSE c.direct_user_low
          END
        WHERE c.id = ?
        GROUP BY c.id, c.type, c.hall_key, c.name, c.avatar_url,
                 direct_user.username, direct_user.avatar_url,
                 c.owner_id, c.direct_user_low, c.direct_user_high,
                 c.status, c.updated_at
        LIMIT 1`,
      [userId, conversationId],
    );
    return rows[0] || null;
  },

  async ensureDirect(pairLow, pairHigh, connection = db) {
    const [result] = await connection.query(
      `INSERT INTO chat_conversations
        (type, direct_user_low, direct_user_high, status)
       VALUES ('direct', ?, ?, 'active')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), status = 'active'`,
      [pairLow, pairHigh],
    );
    const conversationId = String(result.insertId);
    await connection.query(
      `INSERT INTO chat_conversation_members (conversation_id, user_id, role, status)
       VALUES (?, ?, 'member', 'active'), (?, ?, 'member', 'active')
       ON DUPLICATE KEY UPDATE status = 'active'`,
      [conversationId, pairLow, conversationId, pairHigh],
    );
    return this.findById(conversationId, connection);
  },

  async createGroup(name, ownerId, connection = db) {
    const [result] = await connection.query(
      `INSERT INTO chat_conversations (type, name, owner_id, status)
       VALUES ('group', ?, ?, 'active')`,
      [name, ownerId],
    );
    const conversationId = String(result.insertId);
    await this.addMember(conversationId, ownerId, 'owner', connection);
    return this.findById(conversationId, connection);
  },

  async addMember(conversationId, userId, role = 'member', connection = db) {
    await connection.query(
      `INSERT INTO chat_conversation_members (conversation_id, user_id, role, status)
       VALUES (?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active', joined_at = NOW()`,
      [conversationId, userId, role],
    );
  },

  async updateMemberRole(conversationId, userId, role, connection = db) {
    await connection.query(
      `UPDATE chat_conversation_members
          SET role = ?, status = 'active'
        WHERE conversation_id = ? AND user_id = ?`,
      [role, conversationId, userId],
    );
  },

  async findByDirectPair(pairLow, pairHigh, connection = db) {
    const [rows] = await connection.query(
      `SELECT id, type, hall_key, name, avatar_url, owner_id,
              direct_user_low, direct_user_high, status, updated_at
         FROM chat_conversations
        WHERE type = 'direct' AND direct_user_low = ? AND direct_user_high = ?
        LIMIT 1`,
      [pairLow, pairHigh],
    );
    return rows[0] || null;
  },

  async updateMetadata(conversationId, patch, connection = db) {
    const sets = [];
    const params = [];
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
      sets.push('name = ?');
      params.push(patch.name || null);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'avatarUrl')) {
      sets.push('avatar_url = ?');
      params.push(patch.avatarUrl || null);
    }
    if (!sets.length) return;
    params.push(conversationId);
    await connection.query(
      `UPDATE chat_conversations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params,
    );
  },

  async listForUser(userId, { type = 'all', limit = 50 } = {}) {
    const normalizedType = ['all', 'direct', 'group'].includes(type) ? type : 'all';
    const [rows] = await db.query(
      `SELECT c.id, c.type,
              COALESCE(c.name, direct_user.username) AS name,
              COALESCE(c.avatar_url, direct_user.avatar_url) AS avatar_url,
              c.owner_id, c.updated_at,
              COUNT(DISTINCT cm_all.user_id) AS member_count,
              lm.id AS last_message_id,
              lm.type AS last_message_type,
              lm.content AS last_message_content,
              lm.sender_id AS last_message_sender_id,
              lm_sender.username AS last_message_sender_username,
              lm_sender.avatar_url AS last_message_sender_avatar_url,
              lm.created_at AS last_message_created_at
         FROM chat_conversations c
         LEFT JOIN chat_conversation_members cm_user
           ON cm_user.conversation_id = c.id
          AND cm_user.user_id = ?
          AND cm_user.status = 'active'
         LEFT JOIN chat_conversation_members cm_all
           ON cm_all.conversation_id = c.id
          AND cm_all.status = 'active'
         LEFT JOIN userlist direct_user
           ON c.type = 'direct'
          AND direct_user.id = CASE
            WHEN c.direct_user_low = ? THEN c.direct_user_high
            ELSE c.direct_user_low
          END
         LEFT JOIN chat_messages lm ON lm.id = c.last_message_id
         LEFT JOIN userlist lm_sender ON lm_sender.id = lm.sender_id
        WHERE c.status = 'active'
          AND (c.type = 'hall' OR cm_user.user_id IS NOT NULL)
          AND (? = 'all' OR c.type = ?)
        GROUP BY c.id, c.type, c.name, c.avatar_url, direct_user.username,
                 direct_user.avatar_url, c.owner_id, c.updated_at,
                 lm.id, lm.type, lm.content, lm.sender_id, lm.created_at,
                 lm_sender.username, lm_sender.avatar_url
        ORDER BY CASE WHEN c.type = 'hall' THEN 0 ELSE 1 END,
                 c.updated_at DESC, c.id DESC
        LIMIT ?`,
      [userId, userId, normalizedType, normalizedType, limit],
    );
    return rows.map(mapConversation);
  },

  async findMember(conversationId, userId, connection = db) {
    const [rows] = await connection.query(
      `SELECT conversation_id, user_id, role, status, last_read_message_id
         FROM chat_conversation_members
        WHERE conversation_id = ? AND user_id = ?
        LIMIT 1`,
      [conversationId, userId],
    );
    return rows[0] || null;
  },

  async listMemberIds(conversationId, connection = db) {
    const [rows] = await connection.query(
      `SELECT user_id
         FROM chat_conversation_members
        WHERE conversation_id = ? AND status = 'active'`,
      [conversationId],
    );
    return rows.map((row) => String(row.user_id));
  },

  async setMemberStatus(conversationId, userIds, status, connection = db) {
    if (!userIds.length) return;
    await connection.query(
      `UPDATE chat_conversation_members
          SET status = ?
        WHERE conversation_id = ? AND user_id IN (?)`,
      [status, conversationId, userIds],
    );
  },
};

module.exports = { chatConversationRepository, mapConversation };
