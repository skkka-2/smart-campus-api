const crypto = require('node:crypto');
const messageRepository = require('../repositories/messageRepository');
const userRepository = require('../repositories/userRepository');
const { db } = require('../db');
const chatSocketTicketRepository = require('../repositories/chatSocketTicketRepository');
const {
  chatConversationRepository,
  mapConversation,
} = require('../repositories/chatConversationRepository');
const { chatFriendRepository, mapFriend } = require('../repositories/chatFriendRepository');
const { chatGroupRepository, mapInvite } = require('../repositories/chatGroupRepository');
const {
  conversationMessageRepository,
  mapMessage,
} = require('../repositories/conversationMessageRepository');
const {
  DEFAULT_MESSAGE_LIMIT,
  MAX_MESSAGE_LIMIT,
  MAX_TEXT_LENGTH,
  SOCKET_TICKET_TTL_SECONDS,
  HALL_KEY,
} = require('../chat/constants');
const { chatError } = require('../chat/errors');
const { canonicalPair, normalizeUserId } = require('../chat/identity');

function parseLimit(value, fallback = DEFAULT_MESSAGE_LIMIT) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(MAX_MESSAGE_LIMIT, Math.max(1, limit));
}

function normalizeId(value, fieldName) {
  if (value == null || !/^\d+$/.test(String(value)) || Number(value) <= 0) {
    throw chatError('CHAT_MESSAGE_INVALID', `${fieldName} 不合法`);
  }
  return String(value);
}

function normalizeContent(type, content) {
  if (type !== 'text') {
    throw chatError('CHAT_MESSAGE_INVALID', '当前只支持文本消息');
  }

  const text = typeof content === 'string' ? content : content?.text;
  if (typeof text !== 'string') {
    throw chatError('CHAT_MESSAGE_INVALID', '消息内容必须是文本');
  }
  const normalizedText = text.trim();
  if (!normalizedText || normalizedText.length > MAX_TEXT_LENGTH) {
    throw chatError('CHAT_MESSAGE_INVALID', `消息长度必须在 1-${MAX_TEXT_LENGTH} 字之间`);
  }
  return { text: normalizedText };
}

function isDuplicateError(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

function toIso(date) {
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

function parseChatUserId(value, fieldName = 'userId') {
  try {
    return normalizeUserId(value, fieldName);
  } catch {
    throw chatError('CHAT_FRIEND_REQUEST_INVALID', `${fieldName} 不合法`);
  }
}

function getPair(left, right) {
  try {
    return canonicalPair(left, right);
  } catch {
    throw chatError('CHAT_FRIEND_REQUEST_INVALID', '不能对自己发起好友关系操作');
  }
}

function formatFriendshipError(existing, userId) {
  if (!existing) return null;
  if (existing.status === 'accepted') {
    throw chatError('CHAT_FRIEND_REQUEST_INVALID', '你们已经是好友', 409);
  }
  if (existing.status === 'blocked') {
    throw chatError('CHAT_FRIEND_REQUEST_INVALID', '该好友关系不可用', 403);
  }
  if (existing.status === 'pending') {
    const direction =
      String(existing.requester_id) === String(userId) ? '已发出' : '对方已向你发起';
    throw chatError('CHAT_FRIEND_REQUEST_INVALID', `好友申请${direction}`, 409);
  }
}

function parseGroupName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 128) {
    throw chatError('CHAT_GROUP_FORBIDDEN', '群名称必须是 1-128 个字符');
  }
  return name;
}

const chatService = {
  /** 拉最新旧版大厅记录,保留给旧接口过渡使用。新代码走 chat_messages。 */
  async history(limit = 10) {
    return messageRepository.latest(limit);
  },

  /** 旧 WebSocket 的写入兼容层,新 /chat 连接不会使用。 */
  async save({ senderId, receiverId, content } = {}) {
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const id = await messageRepository.create({ senderId, receiverId, content, createdAt });
    return { id, createdAt };
  },

  async ensureHall() {
    return chatConversationRepository.ensureHall(HALL_KEY);
  },

  async createSocketTicket(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw chatError('CHAT_SOCKET_TICKET_INVALID', '账号不存在或已失效', 401);
    const ticket = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(ticket).digest();
    const expiresAt = new Date(Date.now() + SOCKET_TICKET_TTL_SECONDS * 1000);
    await chatSocketTicketRepository.create({ userId, tokenHash, expiresAt });
    return {
      ticket,
      ttlSeconds: SOCKET_TICKET_TTL_SECONDS,
      expiresAt: expiresAt.toISOString(),
    };
  },

  async consumeSocketTicket(ticket) {
    if (!ticket || typeof ticket !== 'string' || ticket.length > 256) {
      throw chatError('CHAT_SOCKET_TICKET_INVALID', '聊天连接凭证无效', 401);
    }
    const tokenHash = crypto.createHash('sha256').update(ticket).digest();
    const row = await chatSocketTicketRepository.consume(tokenHash);
    if (!row) throw chatError('CHAT_SOCKET_TICKET_INVALID', '聊天连接凭证已失效', 401);
    return String(row.user_id);
  },

  async listConversations(userId, options = {}) {
    await this.ensureHall();
    return chatConversationRepository.listForUser(userId, {
      type: options.type,
      limit: parseLimit(options.limit, 50),
    });
  },

  async getConversation(userId, conversationId) {
    const conversation = await this.assertConversationAccess(userId, conversationId);
    const detailed = await chatConversationRepository.findByIdForUser(
      conversation.id,
      userId,
    );
    return mapConversation(detailed || conversation);
  },

  async searchUsers(userId, keyword, limit = 20) {
    const normalizedUserId = parseChatUserId(userId);
    const normalizedLimit = Math.min(20, Math.max(1, Number.parseInt(limit, 10) || 20));
    return userRepository.search(keyword, normalizedUserId, normalizedLimit);
  },

  async listFriends(userId) {
    return chatFriendRepository.listFriends(parseChatUserId(userId));
  },

  async listFriendRequests(userId, direction = 'incoming') {
    if (!['incoming', 'outgoing'].includes(direction)) {
      throw chatError('CHAT_FRIEND_REQUEST_INVALID', 'direction 不合法');
    }
    return chatFriendRepository.listRequests(parseChatUserId(userId), direction);
  },

  async createFriendRequest(userId, { addresseeId, remark } = {}) {
    const requesterId = parseChatUserId(userId, 'requesterId');
    const normalizedAddresseeId = parseChatUserId(addresseeId, 'addresseeId');
    const pair = getPair(requesterId, normalizedAddresseeId);
    const addressee = await userRepository.findById(normalizedAddresseeId);
    if (!addressee) throw chatError('CHAT_FRIEND_REQUEST_INVALID', '用户不存在', 404);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const existing = await chatFriendRepository.findByPair(pair.low, pair.high, connection, true);
      if (existing) {
        if (existing.status === 'rejected') {
          await chatFriendRepository.updateStatus(
            existing.id,
            'pending',
            {
              requesterId,
              addresseeId: normalizedAddresseeId,
              remark: String(remark || '')
                .trim()
                .slice(0, 255),
            },
            connection,
          );
        } else {
          formatFriendshipError(existing, requesterId);
        }
      }

      const id = existing
        ? existing.id
        : await chatFriendRepository.insert(
            {
              requesterId,
              addresseeId: normalizedAddresseeId,
              pairLow: pair.low,
              pairHigh: pair.high,
              remark: String(remark || '')
                .trim()
                .slice(0, 255),
            },
            connection,
          );
      const row = await chatFriendRepository.findById(id, connection);
      await connection.commit();
      return mapFriend(row);
    } catch (error) {
      await connection.rollback();
      if (isDuplicateError(error)) {
        throw chatError('CHAT_FRIEND_REQUEST_INVALID', '好友申请已存在', 409);
      }
      throw error;
    } finally {
      connection.release();
    }
  },

  async respondFriendRequest(userId, requestId, action) {
    const addresseeId = parseChatUserId(userId);
    const normalizedRequestId = normalizeId(requestId, 'requestId');
    if (!['accept', 'reject'].includes(action)) {
      throw chatError('CHAT_FRIEND_REQUEST_INVALID', 'action 不合法');
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const request = await chatFriendRepository.findById(normalizedRequestId, connection, true);
      if (!request || String(request.addressee_id) !== addresseeId) {
        throw chatError('CHAT_FRIEND_REQUEST_INVALID', '无权处理该好友申请', 403);
      }
      if (request.status !== 'pending') {
        throw chatError('CHAT_FRIEND_REQUEST_INVALID', '好友申请已经处理过了', 409);
      }

      const nextStatus = action === 'accept' ? 'accepted' : 'rejected';
      await chatFriendRepository.updateStatus(normalizedRequestId, nextStatus, {}, connection);
      let conversation = null;
      if (action === 'accept') {
        conversation = await chatConversationRepository.ensureDirect(
          request.pair_low,
          request.pair_high,
          connection,
        );
      }
      const updated = await chatFriendRepository.findById(normalizedRequestId, connection);
      await connection.commit();
      if (conversation) {
        const detailedConversation = await chatConversationRepository.findByIdForUser(
          conversation.id,
          addresseeId,
        );
        conversation = detailedConversation || conversation;
      }
      return {
        friendRequest: mapFriend(updated),
        conversation: conversation ? mapConversation(conversation) : null,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async createDirectConversation(userId, targetUserId) {
    const currentUserId = parseChatUserId(userId);
    const normalizedTargetId = parseChatUserId(targetUserId, 'userId');
    const pair = getPair(currentUserId, normalizedTargetId);
    if (!(await userRepository.findById(normalizedTargetId))) {
      throw chatError('CHAT_CONVERSATION_NOT_FOUND', '用户不存在', 404);
    }

    const friendship = await chatFriendRepository.findByPair(pair.low, pair.high);
    if (!friendship || friendship.status !== 'accepted') {
      throw chatError('CHAT_FRIEND_REQUEST_INVALID', '成为好友后才能发起私聊', 403);
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const conversation = await chatConversationRepository.ensureDirect(
        pair.low,
        pair.high,
        connection,
      );
      await connection.commit();
      const detailedConversation = await chatConversationRepository.findByIdForUser(
        conversation.id,
        currentUserId,
      );
      return mapConversation(detailedConversation || conversation);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async removeFriend(userId, targetUserId) {
    const currentUserId = parseChatUserId(userId);
    const normalizedTargetId = parseChatUserId(targetUserId, 'userId');
    const pair = getPair(currentUserId, normalizedTargetId);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const friendship = await chatFriendRepository.findByPair(
        pair.low,
        pair.high,
        connection,
        true,
      );
      if (!friendship || friendship.status !== 'accepted') {
        throw chatError('CHAT_FRIEND_REQUEST_INVALID', '好友关系不存在', 404);
      }
      await connection.query(
        `DELETE FROM chat_friendships
          WHERE pair_low = ? AND pair_high = ?`,
        [pair.low, pair.high],
      );
      const direct = await chatConversationRepository.findByDirectPair(
        pair.low,
        pair.high,
        connection,
      );
      if (direct) {
        await chatConversationRepository.setMemberStatus(
          direct.id,
          [pair.low, pair.high],
          'removed',
          connection,
        );
      }
      await connection.commit();
      return { removed: true, conversationId: direct ? String(direct.id) : null };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async assertGroup(userId, groupId, connection = db) {
    const conversation = await this.assertConversationAccess(userId, groupId, connection);
    if (conversation.type !== 'group') {
      throw chatError('CHAT_GROUP_FORBIDDEN', '目标会话不是群组', 403);
    }
    const member = await chatConversationRepository.findMember(conversation.id, userId, connection);
    if (!member || member.status !== 'active') {
      throw chatError('CHAT_GROUP_FORBIDDEN', '你不是群成员', 403);
    }
    return { conversation, member };
  },

  async assertGroupManager(userId, groupId, connection = db) {
    const result = await this.assertGroup(userId, groupId, connection);
    if (!['owner', 'admin'].includes(result.member.role)) {
      throw chatError('CHAT_GROUP_FORBIDDEN', '只有群主或管理员可以执行此操作', 403);
    }
    return result;
  },

  async assertAcceptedFriend(leftUserId, rightUserId, connection = db) {
    const pair = getPair(leftUserId, rightUserId);
    const friendship = await chatFriendRepository.findByPair(pair.low, pair.high, connection);
    if (!friendship || friendship.status !== 'accepted') {
      throw chatError('CHAT_GROUP_FORBIDDEN', '只能邀请好友加入群组', 403);
    }
    return pair;
  },

  async createGroup(userId, { name, memberIds = [] } = {}) {
    const ownerId = parseChatUserId(userId);
    const groupName = parseGroupName(name);
    if (!Array.isArray(memberIds) || memberIds.length > 49) {
      throw chatError('CHAT_GROUP_FORBIDDEN', '一次最多添加 49 位初始成员');
    }
    const uniqueMemberIds = Array.from(
      new Set(memberIds.map((memberId) => parseChatUserId(memberId, 'memberId'))),
    ).filter((memberId) => memberId !== ownerId);

    for (const memberId of uniqueMemberIds) {
      if (!(await userRepository.findById(memberId))) {
        throw chatError('CHAT_GROUP_FORBIDDEN', `用户 ${memberId} 不存在`, 404);
      }
      await this.assertAcceptedFriend(ownerId, memberId);
    }

    const connection = await db.getConnection();
    let conversationId;
    try {
      await connection.beginTransaction();
      const conversation = await chatConversationRepository.createGroup(groupName, ownerId, connection);
      conversationId = conversation.id;
      for (const memberId of uniqueMemberIds) {
        await chatConversationRepository.addMember(conversation.id, memberId, 'member', connection);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.getGroup(ownerId, conversationId);
  },

  async getGroup(userId, groupId) {
    const { conversation } = await this.assertGroup(userId, groupId);
    const members = await chatGroupRepository.listMembers(conversation.id);
    return { ...mapConversation(conversation), memberCount: members.length, members };
  },

  async listGroupMembers(userId, groupId) {
    const { conversation } = await this.assertGroup(userId, groupId);
    return chatGroupRepository.listMembers(conversation.id);
  },

  async listGroupInvites(userId) {
    return chatGroupRepository.listInvitesForUser(parseChatUserId(userId));
  },

  async updateGroup(userId, groupId, patch = {}) {
    await this.assertGroupManager(userId, groupId);
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) patch.name = parseGroupName(patch.name);
    if (patch.avatarUrl != null && String(patch.avatarUrl).length > 500) {
      throw chatError('CHAT_GROUP_FORBIDDEN', '群头像地址过长');
    }
    await chatConversationRepository.updateMetadata(groupId, patch);
    return this.getGroup(userId, groupId);
  },

  async createGroupInvite(userId, groupId, inviteeId) {
    const inviterId = parseChatUserId(userId);
    const normalizedInviteeId = parseChatUserId(inviteeId, 'inviteeId');
    if (inviterId === normalizedInviteeId) {
      throw chatError('CHAT_GROUP_FORBIDDEN', '不能邀请自己');
    }
    await this.assertGroupManager(inviterId, groupId);
    if (!(await userRepository.findById(normalizedInviteeId))) {
      throw chatError('CHAT_GROUP_FORBIDDEN', '用户不存在', 404);
    }
    await this.assertAcceptedFriend(inviterId, normalizedInviteeId);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const member = await chatConversationRepository.findMember(groupId, normalizedInviteeId, connection);
      if (member?.status === 'active') {
        throw chatError('CHAT_GROUP_FORBIDDEN', '用户已经在群里', 409);
      }
      const existing = await chatGroupRepository.findInvite(
        groupId,
        normalizedInviteeId,
        connection,
        true,
      );
      let inviteId;
      if (existing && existing.status === 'pending') {
        throw chatError('CHAT_GROUP_FORBIDDEN', '群邀请已经发出', 409);
      }
      if (existing) {
        await connection.query(
          `UPDATE chat_group_invites
              SET inviter_id = ?, status = 'pending', updated_at = NOW()
            WHERE id = ?`,
          [inviterId, existing.id],
        );
        inviteId = existing.id;
      } else {
        inviteId = await chatGroupRepository.insertInvite({
          conversationId: groupId,
          inviterId,
          inviteeId: normalizedInviteeId,
        }, connection);
      }
      const invite = await chatGroupRepository.findInviteById(inviteId, connection);
      await connection.commit();
      return mapInvite(invite);
    } catch (error) {
      await connection.rollback();
      if (isDuplicateError(error)) {
        throw chatError('CHAT_GROUP_FORBIDDEN', '群邀请已经发出', 409);
      }
      throw error;
    } finally {
      connection.release();
    }
  },

  async respondGroupInvite(userId, inviteId, action) {
    const inviteeId = parseChatUserId(userId);
    const normalizedInviteId = normalizeId(inviteId, 'inviteId');
    if (!['accept', 'reject'].includes(action)) {
      throw chatError('CHAT_GROUP_FORBIDDEN', 'action 不合法');
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const invite = await chatGroupRepository.findInviteById(normalizedInviteId, connection, true);
      if (!invite || String(invite.invitee_id) !== inviteeId) {
        throw chatError('CHAT_GROUP_FORBIDDEN', '无权处理该群邀请', 403);
      }
      if (invite.status !== 'pending') {
        throw chatError('CHAT_GROUP_FORBIDDEN', '群邀请已经处理过了', 409);
      }
      const conversation = await chatConversationRepository.findById(
        invite.conversation_id,
        connection,
      );
      if (!conversation || conversation.type !== 'group' || conversation.status !== 'active') {
        throw chatError('CHAT_GROUP_FORBIDDEN', '群组已经不可用', 409);
      }
      await chatGroupRepository.updateInviteStatus(
        normalizedInviteId,
        action === 'accept' ? 'accepted' : 'rejected',
        connection,
      );
      if (action === 'accept') {
        await chatConversationRepository.addMember(invite.conversation_id, inviteeId, 'member', connection);
      }
      const updated = await chatGroupRepository.findInviteById(normalizedInviteId, connection);
      await connection.commit();
      return mapInvite(updated);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async addGroupMember(userId, groupId, targetUserId) {
    const managerId = parseChatUserId(userId);
    const targetId = parseChatUserId(targetUserId, 'userId');
    await this.assertGroupManager(managerId, groupId);
    if (!(await userRepository.findById(targetId))) {
      throw chatError('CHAT_GROUP_FORBIDDEN', '用户不存在', 404);
    }
    await this.assertAcceptedFriend(managerId, targetId);
    await chatConversationRepository.addMember(groupId, targetId, 'member');
    return { groupId: String(groupId), userId: targetId, added: true };
  },

  async removeGroupMember(userId, groupId, targetUserId) {
    const managerId = parseChatUserId(userId);
    const targetId = parseChatUserId(targetUserId, 'userId');
    const { member: manager } = await this.assertGroupManager(managerId, groupId);
    const target = await chatConversationRepository.findMember(groupId, targetId);
    if (!target || target.status !== 'active') {
      throw chatError('CHAT_GROUP_FORBIDDEN', '目标不是当前群成员', 404);
    }
    if (target.role === 'owner' || (manager.role === 'admin' && target.role === 'admin')) {
      throw chatError('CHAT_GROUP_FORBIDDEN', '当前权限不能移除该成员', 403);
    }
    await chatConversationRepository.setMemberStatus(groupId, [targetId], 'removed');
    return { groupId: String(groupId), userId: targetId, removed: true };
  },

  async updateGroupMemberRole(userId, groupId, targetUserId, role) {
    const ownerId = parseChatUserId(userId);
    const targetId = parseChatUserId(targetUserId, 'userId');
    if (!['admin', 'member'].includes(role)) {
      throw chatError('CHAT_GROUP_FORBIDDEN', 'role 不合法');
    }
    const { member: owner } = await this.assertGroup(ownerId, groupId);
    if (owner.role !== 'owner') throw chatError('CHAT_GROUP_FORBIDDEN', '只有群主可以设置管理员', 403);
    const target = await chatConversationRepository.findMember(groupId, targetId);
    if (!target || target.status !== 'active' || target.role === 'owner') {
      throw chatError('CHAT_GROUP_FORBIDDEN', '目标不是可设置的群成员', 400);
    }
    await chatConversationRepository.updateMemberRole(groupId, targetId, role);
    return { groupId: String(groupId), userId: targetId, role };
  },

  async leaveGroup(userId, groupId) {
    const memberId = parseChatUserId(userId);
    const { conversation, member } = await this.assertGroup(memberId, groupId);
    if (member.role === 'owner') {
      const members = await chatConversationRepository.listMemberIds(conversation.id);
      if (members.length > 1) {
        throw chatError('CHAT_GROUP_FORBIDDEN', '群主需要先转让群主身份', 409);
      }
      await db.query(
        `UPDATE chat_conversations SET status = 'archived', owner_id = NULL WHERE id = ?`,
        [conversation.id],
      );
    }
    await chatConversationRepository.setMemberStatus(conversation.id, [memberId], 'left');
    return { groupId: String(conversation.id), left: true };
  },

  async assertConversationAccess(userId, conversationId, connection = db) {
    const id = normalizeId(conversationId, 'conversationId');
    const conversation = await chatConversationRepository.findById(id, connection);
    if (!conversation || conversation.status !== 'active') {
      throw chatError('CHAT_CONVERSATION_NOT_FOUND', '会话不存在', 404);
    }

    if (conversation.type !== 'hall') {
      const member = await chatConversationRepository.findMember(id, userId, connection);
      if (!member || member.status !== 'active') {
        throw chatError('CHAT_CONVERSATION_FORBIDDEN', '无权访问该会话', 403);
      }
      if (conversation.type === 'direct') {
        const friendship = await chatFriendRepository.findByPair(
          conversation.direct_user_low,
          conversation.direct_user_high,
          connection,
        );
        if (!friendship || friendship.status !== 'accepted') {
          throw chatError('CHAT_CONVERSATION_FORBIDDEN', '好友关系已失效', 403);
        }
      }
    }
    return conversation;
  },

  async listMessages(userId, conversationId, options = {}) {
    await this.assertConversationAccess(userId, conversationId);
    return conversationMessageRepository.listByConversation(conversationId, {
      limit: parseLimit(options.limit),
      before: options.before == null ? null : normalizeId(options.before, 'before'),
    });
  },

  async sendMessage({
    userId,
    conversationId,
    clientMessageId,
    type = 'text',
    content,
    replyToId = null,
  }) {
    const normalizedConversationId = normalizeId(conversationId, 'conversationId');
    const normalizedSenderId = normalizeId(userId, 'senderId');
    const normalizedClientMessageId = String(clientMessageId || '');
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(normalizedClientMessageId)) {
      throw chatError('CHAT_MESSAGE_INVALID', 'clientMessageId 不合法');
    }
    const normalizedContent = normalizeContent(type, content);
    const normalizedReplyToId = replyToId == null ? null : normalizeId(replyToId, 'replyToId');

    await this.assertConversationAccess(normalizedSenderId, normalizedConversationId);

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const existing = await conversationMessageRepository.findByClientMessageId(
        {
          senderId: normalizedSenderId,
          conversationId: normalizedConversationId,
          clientMessageId: normalizedClientMessageId,
        },
        connection,
      );
      if (existing) {
        await connection.commit();
        return { message: mapMessage(existing), duplicate: true };
      }

      const messageId = await conversationMessageRepository.insert(
        {
          conversationId: normalizedConversationId,
          senderId: normalizedSenderId,
          clientMessageId: normalizedClientMessageId,
          type,
          content: normalizedContent,
          replyToId: normalizedReplyToId,
        },
        connection,
      );

      await connection.query(
        `UPDATE chat_conversations
            SET last_message_id = ?, updated_at = NOW()
          WHERE id = ?`,
        [messageId, normalizedConversationId],
      );
      const [rows] = await connection.query(
        `SELECT m.id, m.conversation_id, m.client_message_id, m.sender_id, m.type, m.content,
                m.reply_to_id, m.created_at, m.edited_at, m.recalled_at,
                u.username AS sender_username, u.avatar_url AS sender_avatar_url
           FROM chat_messages m
           JOIN userlist u ON u.id = m.sender_id
          WHERE m.id = ?
          LIMIT 1`,
        [messageId],
      );
      await connection.commit();
      return { message: mapMessage(rows[0]), duplicate: false };
    } catch (error) {
      await connection.rollback();
      if (isDuplicateError(error)) {
        const existing = await conversationMessageRepository.findByClientMessageId({
          senderId: normalizedSenderId,
          conversationId: normalizedConversationId,
          clientMessageId: normalizedClientMessageId,
        });
        if (existing) return { message: mapMessage(existing), duplicate: true };
      }
      throw error;
    } finally {
      connection.release();
    }
  },

  async audienceUserIds(userId, conversationId) {
    const conversation = await this.assertConversationAccess(userId, conversationId);
    if (conversation.type === 'hall') return null;
    return chatConversationRepository.listMemberIds(conversation.id);
  },

  async markRead(userId, conversationId, messageId) {
    const conversation = await this.assertConversationAccess(userId, conversationId);
    const normalizedMessageId = normalizeId(messageId, 'messageId');
    const message = await conversationMessageRepository.findById(normalizedMessageId);
    if (!message || String(message.conversation_id) !== String(conversation.id)) {
      throw chatError('CHAT_MESSAGE_INVALID', '消息不属于该会话');
    }

    // 大厅采用隐式成员，不为每个用户写成员行；已读状态在后续 unread 投影阶段补上。
    if (conversation.type === 'hall') {
      return { conversationId: String(conversation.id), messageId: normalizedMessageId };
    }
    const updated = await conversationMessageRepository.markRead(
      conversation.id,
      userId,
      normalizedMessageId,
    );
    if (!updated) throw chatError('CHAT_CONVERSATION_FORBIDDEN', '无权更新该会话已读状态', 403);
    return { conversationId: String(conversation.id), messageId: normalizedMessageId };
  },

  toIso,
};

module.exports = chatService;
