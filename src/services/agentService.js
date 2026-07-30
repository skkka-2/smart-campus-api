const agent = require('../agent');

async function runAgent(userId, userMessage, onEvent, context) {
  return agent.runAgent({
    userId,
    message: userMessage,
    onEvent,
    context,
  });
}

async function history(userId) {
  return agent.getHistory({ userId });
}

async function clearHistory(userId) {
  return agent.clearHistory({ userId });
}

async function confirmAction(userId, { action, payload } = {}) {
  return agent.confirmAction({ userId, action, payload });
}

module.exports = {
  runAgent,
  history,
  clearHistory,
  confirmAction,
};
