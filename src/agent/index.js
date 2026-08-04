const runner = require('./runner');
const memoryService = require('./memoryService');
const toolRegistry = require('./toolRegistry');
const agentEventRepository = require('../repositories/agentEventRepository');
const { validateToolArgsObject } = require('./toolValidator');
const { BizError } = require('../utils/response');

async function runAgent({
  userId, message, onEvent, context, signal, sessionId,
}) {
  return runner.runAgent({
    userId, message, onEvent, context, signal, sessionId,
  });
}

async function getHistory({ userId }) {
  return memoryService.getHistory({ userId });
}

async function clearHistory({ userId }) {
  return memoryService.clearHistory({ userId });
}

async function confirmAction({ userId, action, payload }) {
  if (!userId) throw BizError.unauthorized('请先登录');
  if (!action) throw BizError.badRequest('缺少 action');

  const tool = toolRegistry.getToolDefinition(action);
  if (!tool) throw BizError.badRequest(`未知 action:${action}`);
  if (!toolRegistry.requiresConfirmation(action, payload || {})) {
    throw BizError.badRequest(`${action} 不需要确认流程`);
  }

  // 参数校验：和 runner 走同一套 schema。
  // 之前 confirmAction 直接把前端 payload 塞进 handler，绕过了 runner 的校验——
  // 而这条路走的恰好是唯一的高危工具 apply_job。
  const args = validateToolArgsObject(tool, payload);
  const result = await tool.handler(args, { userId });
  return {
    action,
    status: 'done',
    result,
  };
}

// P3-2 会话回放：列出会话 + 拉某会话的完整事件轨迹
async function listSessions({ userId }) {
  return agentEventRepository.listSessions(userId);
}

async function listSessionEvents({ userId, sessionId }) {
  if (!sessionId) throw BizError.badRequest('缺少 sessionId');
  return agentEventRepository.listBySession(userId, sessionId);
}

module.exports = {
  runAgent,
  getHistory,
  clearHistory,
  confirmAction,
  listSessions,
  listSessionEvents,
};
