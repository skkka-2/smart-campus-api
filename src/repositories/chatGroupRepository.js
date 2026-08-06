const { db } = require('../db');

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMember(row) {
  return {
    userId: String(row.user_id),
    username: row.username,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    joinedAt: toIso(row.joined_at),
    lastReadMessageId: row.last_read_message_id == null ? null : String(row.last_read_message_id),
  };
}

function mapInvite(row) {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    inviterId: String(row.inviter_id),
    inviteeId: String(row.invitee_id),
    status: row.status,
    group:
      row.group_name == null
        ? null
        : {
            id: String(row.conversation_id),
            name: row.group_name,
          },
    inviter:
      row.inviter_username == null
        ? null
        : {
            id: String(row.inviter_id),
            username: row.inviter_username,
            avatarUrl: row.inviter_avatar_url,
          },
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const chatGroupRepository = {
  async listMembers(conversationId) {
    const [rows] = await db.query(
      `SELECT m.user_id, m.role, m.status, m.joined_at, m.last_read_message_id,
              u.username, u.avatar_url
         FROM chat_conversation_members m
        JOIN userlist u ON u.id = m.user_id
        WHERE m.conversation_id = ? AND m.status = 'active'
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                 m.joined_at ASC`,
      [conversationId],
    );
    return rows.map(mapMember);
  },

  async findInviteById(id, connection = db, forUpdate = false) {
    const [rows] = await connection.query(
      `SELECT id, conversation_id, inviter_id, invitee_id, status, created_at, updated_at
         FROM chat_group_invites
        WHERE id = ?
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] || null;
  },

  async findInvite(conversationId, inviteeId, connection = db, forUpdate = false) {
    const [rows] = await connection.query(
      `SELECT id, conversation_id, inviter_id, invitee_id, status, created_at, updated_at
         FROM chat_group_invites
        WHERE conversation_id = ? AND invitee_id = ?
        ORDER BY id DESC
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [conversationId, inviteeId],
    );
    return rows[0] || null;
  },

  async insertInvite({ conversationId, inviterId, inviteeId }, connection = db) {
    const [result] = await connection.query(
      `INSERT INTO chat_group_invites (conversation_id, inviter_id, invitee_id, status)
       VALUES (?, ?, ?, 'pending')`,
      [conversationId, inviterId, inviteeId],
    );
    return result.insertId;
  },

  async updateInviteStatus(id, status, connection = db) {
    await connection.query(
      `UPDATE chat_group_invites SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, id],
    );
  },

  async listInvitesForUser(userId) {
    const [rows] = await db.query(
      `SELECT i.id, i.conversation_id, i.inviter_id, i.invitee_id,
              i.status, i.created_at, i.updated_at,
              c.name AS group_name,
              u.username AS inviter_username, u.avatar_url AS inviter_avatar_url
         FROM chat_group_invites i
         JOIN chat_conversations c ON c.id = i.conversation_id
         JOIN userlist u ON u.id = i.inviter_id
        WHERE i.invitee_id = ?
          AND i.status = 'pending'
          AND c.type = 'group'
          AND c.status = 'active'
        ORDER BY i.created_at DESC, i.id DESC`,
      [userId],
    );
    return rows.map(mapInvite);
  },
};

module.exports = { chatGroupRepository, mapMember, mapInvite };
