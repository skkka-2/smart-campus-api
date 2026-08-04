const agentService = require('../services/agentService');
const { BizError } = require('../utils/response');

const agentController = {
  /**
   * POST /api/agent/stream
   * body: { message: string, context?: { jobId?: number } }
   *
   * 响应:Server-Sent Events (text/event-stream)
   *   每个事件形如:
   *     event: <type>\n
   *     data: <json>\n\n
   *
   * 事件 type:thinking / tool_call / tool_result / final / error
   */
  async stream(ctx) {
    const { message, context, sessionId } = ctx.request.body || {};
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

    // 客户端断开时真中止 loop：AbortSignal 贯穿到 OpenAI SDK 和工具执行。
    // 旧的 `aborted` 只挡住 send()，LLM 调用和工具继续跑、DB 继续写，
    // 最坏情况是用户关了页面但 apply_job 仍投递成功（不可见副作用）。
    const abortController = new AbortController();
    // Koa 手动 SSE（ctx.respond=false，自己 res.write）场景下 ctx.req.on('close') 不可靠。
    // 实测：curl kill 后 req 的 close/aborted 事件不触发，导致 abortController.abort() 不执行，
    // LLM 跑到底（26 秒）。改监听 res 的 close 事件——它由底层 socket 关闭触发，可靠。
    res.on('close', () => {
      if (!abortController.signal.aborted) {
        console.log('[agent] client disconnected, aborting stream');
        abortController.abort();
      }
    });

    try {
      await agentService.runAgent(ctx.state.user.id, message, (evt) => {
        if (!abortController.signal.aborted) send(evt);
      }, context, abortController.signal, sessionId);
    } catch (err) {
      // AbortError 不是错误，不报错、不发 error 事件（客户端已断开）
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        console.warn('[agent] stream aborted by client');
      } else {
        // err 可能含 api_key（SDK error message），console 整个对象会打印，message 也会发前端
        const { redactSecrets } = require('../observability/secretRedaction');
        console.error('[agent] runAgent error:', redactSecrets(err?.message || String(err)));
        send({ type: 'error', message: redactSecrets(err?.message || 'agent 内部错误') });
      }
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

  /** POST /api/agent/actions/confirm */
  async confirmAction(ctx) {
    const { action, payload } = ctx.request.body || {};
    const data = await agentService.confirmAction(ctx.state.user.id, { action, payload });
    ctx.success(data);
  },
};

module.exports = agentController;
