const chatService = require('../services/chatService');

const chatController = {
  /** GET /api/chat/history?limit=10 */
  async history(ctx) {
    const limit = Math.min(50, Math.max(1, Number.parseInt(ctx.query.limit, 10) || 10));
    const items = await chatService.history(limit);
    ctx.success({ items });
  },
};

module.exports = chatController;
