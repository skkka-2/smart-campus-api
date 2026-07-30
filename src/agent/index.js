const runner = require('./runner');
const memoryService = require('./memoryService');
const toolRegistry = require('./toolRegistry');
const { BizError } = require('../utils/response');

async function runAgent({
  userId, message, onEvent, context,
}) {
  return runner.runAgent({
    userId, message, onEvent, context,
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

  const result = await tool.handler(payload || {}, { userId });
  return {
    action,
    status: 'done',
    result,
  };
}

module.exports = {
  runAgent,
  getHistory,
  clearHistory,
  confirmAction,
};
