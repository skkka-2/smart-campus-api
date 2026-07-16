const aiService = require('../services/aiService');

const aiController = {
  /** POST /api/ai/chat  body: { content } — 从 ctx.state.user.id 拿 userId */
  async chat(ctx) {
    const { content } = ctx.request.body || {};
    const userId = ctx.state.user.id;
    const data = await aiService.chat({ userId, content });
    ctx.success(data);
  },

  /** GET /api/ai/history */
  async history(ctx) {
    const items = await aiService.history(ctx.state.user.id);
    ctx.success({ items });
  },

  /** DELETE /api/ai/history */
  async clear(ctx) {
    const data = await aiService.clearHistory(ctx.state.user.id);
    ctx.success(data, '已清空');
  },
};

module.exports = aiController;
