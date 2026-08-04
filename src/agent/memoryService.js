const chatMessageRepository = require('../repositories/chatMessageRepository');

const MAX_HISTORY = 20;

/**
 * 加载某用户某会话的最近消息（按 session 隔离）。
 * 之前不传 sessionId、走 listByUser 全捞，导致用户不同话题的历史互相污染。
 * refactor plan 的目标签名就是 loadRecentMessages({ userId, sessionId, limit })，
 * 现在补上实现。
 */
async function loadRecentMessages({ userId, sessionId, limit = MAX_HISTORY } = {}) {
  if (!sessionId) {
    // 兜底：没有 sessionId 时退回全量（不应发生，但保持向后兼容）
    const rows = await chatMessageRepository.listByUser(userId);
    const recent = rows.slice(-limit);
    return toMessages(recent);
  }
  const rows = await chatMessageRepository.listBySession(userId, sessionId, limit);
  return toMessages(rows);
}

function toMessages(rows) {
  const messages = [];
  for (const row of rows) {
    if (row.type === 'user') {
      messages.push({ role: 'user', content: row.text });
    } else if (row.type === 'assistant' || row.type === 'ai') {
      messages.push({ role: 'assistant', content: row.text });
    }
  }
  return messages;
}

async function saveMessage({ userId, sessionId, role, text, metadata = null }) {
  await chatMessageRepository.create({
    userId: String(userId),
    type: role,
    text,
    sessionId,
    metadata,
  });
}

async function getHistory({ userId } = {}) {
  const rows = await chatMessageRepository.listByUser(userId);
  return rows.map((row) => ({
    id: row.id,
    role: row.type,
    text: row.text,
    timestamp: row.timestamp,
    metadata: row.metadata,
  }));
}

async function clearHistory({ userId } = {}) {
  // 两个表独立清空，一个失败不挡另一个（chatmessages 可能有历史脏数据导致报错，不该挡 events 清理）
  let chatCleared = 0;
  let eventCleared = 0;
  try {
    chatCleared = await chatMessageRepository.clearByUser(userId);
  } catch (err) {
    console.warn('[agent] clear chatmessages failed:', err.message);
  }
  try {
    const agentEventRepository = require('../repositories/agentEventRepository');
    eventCleared = await agentEventRepository.clearByUser(userId);
  } catch (err) {
    console.warn('[agent] clear agent_events failed:', err.message);
  }
  return { cleared: chatCleared, eventCleared };
}

module.exports = {
  loadRecentMessages,
  saveMessage,
  getHistory,
  clearHistory,
};
