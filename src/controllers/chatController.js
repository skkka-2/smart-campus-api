const chatService = require('../services/chatService');

const chatController = {
  /** GET /api/chat/history?limit=10,legacy endpoint */
  async history(ctx) {
    const limit = Math.min(50, Math.max(1, Number.parseInt(ctx.query.limit, 10) || 10));
    const items = await chatService.history(limit);
    ctx.success({ items });
  },

  /** POST /api/chat/socket-ticket */
  async createSocketTicket(ctx) {
    const data = await chatService.createSocketTicket(ctx.state.user.id);
    ctx.success(data);
  },

  /** GET /api/chat/conversations */
  async listConversations(ctx) {
    const data = await chatService.listConversations(ctx.state.user.id, {
      type: ctx.query.type,
      limit: ctx.query.limit,
    });
    ctx.success({ items: data });
  },

  /** GET /api/chat/conversations/:conversationId */
  async getConversation(ctx) {
    const data = await chatService.getConversation(ctx.state.user.id, ctx.params.conversationId);
    ctx.success(data);
  },

  /** POST /api/chat/conversations/direct */
  async createDirectConversation(ctx) {
    const data = await chatService.createDirectConversation(
      ctx.state.user.id,
      ctx.request.body?.userId,
    );
    ctx.success(data);
  },

  /** POST /api/chat/conversations/group */
  async createGroup(ctx) {
    const data = await chatService.createGroup(ctx.state.user.id, ctx.request.body || {});
    ctx.success(data);
  },

  /** PATCH /api/chat/conversations/:conversationId */
  async updateGroup(ctx) {
    const data = await chatService.updateGroup(
      ctx.state.user.id,
      ctx.params.conversationId,
      ctx.request.body || {},
    );
    ctx.success(data);
  },

  /** GET /api/chat/users/search?q=... */
  async searchUsers(ctx) {
    const data = await chatService.searchUsers(ctx.state.user.id, ctx.query.q, ctx.query.limit);
    ctx.success({ items: data });
  },

  /** GET /api/chat/friends */
  async listFriends(ctx) {
    const data = await chatService.listFriends(ctx.state.user.id);
    ctx.success({ items: data });
  },

  /** GET /api/chat/friend-requests?direction=incoming|outgoing */
  async listFriendRequests(ctx) {
    const data = await chatService.listFriendRequests(ctx.state.user.id, ctx.query.direction);
    ctx.success({ items: data });
  },

  /** POST /api/chat/friend-requests */
  async createFriendRequest(ctx) {
    const data = await chatService.createFriendRequest(ctx.state.user.id, ctx.request.body || {});
    ctx.success(data);
  },

  /** PATCH /api/chat/friend-requests/:requestId */
  async respondFriendRequest(ctx) {
    const data = await chatService.respondFriendRequest(
      ctx.state.user.id,
      ctx.params.requestId,
      ctx.request.body?.action,
    );
    ctx.success(data);
  },

  /** DELETE /api/chat/friends/:userId */
  async removeFriend(ctx) {
    const data = await chatService.removeFriend(ctx.state.user.id, ctx.params.userId);
    ctx.success(data);
  },

  /** GET /api/chat/groups/:groupId */
  async getGroup(ctx) {
    const data = await chatService.getGroup(ctx.state.user.id, ctx.params.groupId);
    ctx.success(data);
  },

  /** GET /api/chat/groups/:groupId/members */
  async listGroupMembers(ctx) {
    const data = await chatService.listGroupMembers(ctx.state.user.id, ctx.params.groupId);
    ctx.success({ items: data });
  },

  /** GET /api/chat/group-invites */
  async listGroupInvites(ctx) {
    const data = await chatService.listGroupInvites(ctx.state.user.id);
    ctx.success({ items: data });
  },

  /** POST /api/chat/groups/:groupId/invites */
  async createGroupInvite(ctx) {
    const data = await chatService.createGroupInvite(
      ctx.state.user.id,
      ctx.params.groupId,
      ctx.request.body?.inviteeId,
    );
    ctx.success(data);
  },

  /** PATCH /api/chat/group-invites/:inviteId */
  async respondGroupInvite(ctx) {
    const data = await chatService.respondGroupInvite(
      ctx.state.user.id,
      ctx.params.inviteId,
      ctx.request.body?.action,
    );
    ctx.success(data);
  },

  /** POST /api/chat/groups/:groupId/members */
  async addGroupMember(ctx) {
    const data = await chatService.addGroupMember(
      ctx.state.user.id,
      ctx.params.groupId,
      ctx.request.body?.userId,
    );
    ctx.success(data);
  },

  /** DELETE /api/chat/groups/:groupId/members/:userId */
  async removeGroupMember(ctx) {
    const data = await chatService.removeGroupMember(
      ctx.state.user.id,
      ctx.params.groupId,
      ctx.params.userId,
    );
    ctx.success(data);
  },

  /** PATCH /api/chat/groups/:groupId/members/:userId/role */
  async updateGroupMemberRole(ctx) {
    const data = await chatService.updateGroupMemberRole(
      ctx.state.user.id,
      ctx.params.groupId,
      ctx.params.userId,
      ctx.request.body?.role,
    );
    ctx.success(data);
  },

  /** POST /api/chat/groups/:groupId/leave */
  async leaveGroup(ctx) {
    const data = await chatService.leaveGroup(ctx.state.user.id, ctx.params.groupId);
    ctx.success(data);
  },

  /** GET /api/chat/conversations/:conversationId/messages */
  async listMessages(ctx) {
    const data = await chatService.listMessages(ctx.state.user.id, ctx.params.conversationId, {
      limit: ctx.query.limit,
      before: ctx.query.before,
    });
    ctx.success(data);
  },

  /** POST /api/chat/conversations/:conversationId/read */
  async markRead(ctx) {
    const data = await chatService.markRead(
      ctx.state.user.id,
      ctx.params.conversationId,
      ctx.request.body?.messageId,
    );
    ctx.success(data);
  },
};

module.exports = chatController;
