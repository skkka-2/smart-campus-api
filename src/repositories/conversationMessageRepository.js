const { db } = require('../db');

function parseContent(value) {
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

function mapMessage(row) {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    clientMessageId: row.client_message_id,
    senderId: String(row.sender_id),
    sender:
      row.sender_username == null
        ? null
        : {
            id: String(row.sender_id),
            username: row.sender_username,
            avatarUrl: row.sender_avatar_url,
          },
    type: row.type,
    content: parseContent(row.content),
    replyToId: row.reply_to_id == null ? null : String(row.reply_to_id),
    createdAt: toIso(row.created_at),
    editedAt: toIso(row.edited_at),
    recalledAt: toIso(row.recalled_at),
  };
}

const MESSAGE_COLUMNS = `
  m.id, m.conversation_id, m.client_message_id, m.sender_id, m.type, m.content,
  m.reply_to_id, m.created_at, m.edited_at, m.recalled_at,
  u.username AS sender_username, u.avatar_url AS sender_avatar_url`;

const conversationMessageRepository = {
  async findByClientMessageId({ senderId, conversationId, clientMessageId }, connection = db) {
    const [rows] = await connection.query(
      `SELECT ${MESSAGE_COLUMNS}
         FROM chat_messages m
         JOIN userlist u ON u.id = m.sender_id
        WHERE m.sender_id = ? AND m.conversation_id = ? AND m.client_message_id = ?
        LIMIT 1`,
      [senderId, conversationId, clientMessageId],
    );
    return rows[0] || null;
  },

  async insert(
    { conversationId, senderId, clientMessageId, type, content, replyToId },
    connection = db,
  ) {
    const [result] = await connection.query(
      `INSERT INTO chat_messages
        (conversation_id, sender_id, client_message_id, type, content, reply_to_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [conversationId, senderId, clientMessageId, type, JSON.stringify(content), replyToId || null],
    );
    return result.insertId;
  },

  async findById(messageId, connection = db) {
    const [rows] = await connection.query(
      `SELECT ${MESSAGE_COLUMNS}
         FROM chat_messages m
         JOIN userlist u ON u.id = m.sender_id
        WHERE m.id = ?
        LIMIT 1`,
      [messageId],
    );
    return rows[0] || null;
  },

  async listByConversation(conversationId, { limit = 30, before = null } = {}) {
    const params = [conversationId];
    let beforeClause = '';
    if (before != null) {
      beforeClause = 'AND m.id < ?';
      params.push(before);
    }
    params.push(limit + 1);

    const [rows] = await db.query(
      `SELECT ${MESSAGE_COLUMNS}
         FROM chat_messages m
         JOIN userlist u ON u.id = m.sender_id
        WHERE m.conversation_id = ? ${beforeClause}
        ORDER BY m.id DESC
        LIMIT ?`,
      params,
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).reverse();
    return {
      items: items.map(mapMessage),
      hasMore,
      nextBefore: hasMore && items.length ? String(items[0].id) : null,
    };
  },

  async markRead(conversationId, userId, messageId) {
    const [result] = await db.query(
      `UPDATE chat_conversation_members
          SET last_read_message_id = ?, last_read_at = NOW()
        WHERE conversation_id = ? AND user_id = ? AND status = 'active'`,
      [messageId, conversationId, userId],
    );
    return result.affectedRows > 0;
  },
};

module.exports = { conversationMessageRepository, mapMessage };
