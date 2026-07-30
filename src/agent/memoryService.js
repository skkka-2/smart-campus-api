const chatMessageRepository = require('../repositories/chatMessageRepository');

const MAX_HISTORY = 20;

async function loadRecentMessages({ userId, limit = MAX_HISTORY } = {}) {
  const rows = await chatMessageRepository.listByUser(userId);
  const recent = rows.slice(-limit);
  const messages = [];
  for (const row of recent) {
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
  const affected = await chatMessageRepository.clearByUser(userId);
  return { cleared: affected };
}

module.exports = {
  loadRecentMessages,
  saveMessage,
  getHistory,
  clearHistory,
};
