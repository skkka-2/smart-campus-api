const agent = require('../agent');

async function runAgent(userId, userMessage, onEvent, context, signal, sessionId) {
  return agent.runAgent({
    userId,
    message: userMessage,
    onEvent,
    context,
    signal,
    sessionId,
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

// P3-2 会话回放
async function listSessions(userId) {
  return agent.listSessions({ userId });
}

async function listSessionEvents(userId, sessionId) {
  return agent.listSessionEvents({ userId, sessionId });
}

module.exports = {
  runAgent,
  history,
  clearHistory,
  confirmAction,
  listSessions,
  listSessionEvents,
};
