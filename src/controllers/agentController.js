const agentService = require('../services/agentService');
const { BizError } = require('../utils/response');

const agentController = {
  /**
   * POST /api/agent/stream
   * body: { message: string }
   *
   * 响应:Server-Sent Events (text/event-stream)
   *   每个事件形如:
   *     event: <type>\n
   *     data: <json>\n\n
   *
   * 事件 type:thinking / tool_call / tool_result / final / error
   */
  async stream(ctx) {
    const { message } = ctx.request.body || {};
    if (!message) throw BizError.badRequest('消息不能为空');

    const res = ctx.res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 关闭 nginx buffer
    });

    // 关键:告诉 Koa 不要处理 body,我们自己写
    ctx.respond = false;

    const send = (event) => {
      try {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch { /* client 断开 */ }
    };

    // 客户端断开时中止 loop
    let aborted = false;
    ctx.req.on('close', () => { aborted = true; });

    try {
      await agentService.runAgent(ctx.state.user.id, message, (evt) => {
        if (!aborted) send(evt);
      });
    } catch (err) {
      console.error('[agent] runAgent error:', err);
      send({ type: 'error', message: err.message || 'agent 内部错误' });
    } finally {
      try { res.end(); } catch { /* noop */ }
    }
  },

  /** GET /api/agent/history */
  async history(ctx) {
    const items = await agentService.history(ctx.state.user.id);
    ctx.success({ items });
  },

  /** DELETE /api/agent/history */
  async clear(ctx) {
    const data = await agentService.clearHistory(ctx.state.user.id);
    ctx.success(data, '已清空');
  },
};

module.exports = agentController;
