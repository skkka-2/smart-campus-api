function createThinkingEvent({ step }) {
  return { type: 'thinking', step };
}

function createToolCallEvent({ id, name, args }) {
  return { type: 'tool_call', id, name, arguments: args };
}

function createToolResultEvent({ id, name, result = null, error = null, summary = null }) {
  return {
    type: 'tool_result',
    id,
    name,
    ok: !error,
    summary: summary || (error ? error : null),
    result: error ? null : result,
    error,
  };
}

function createActionRequiredEvent({ action, payload, confirmText }) {
  return {
    type: 'action_required',
    action,
    payload,
    confirmText,
  };
}

function createFinalEvent({ content, toolCalls = 0, traceContext = null }) {
  return {
    type: 'final',
    content,
    toolCalls,
    traceContext,
  };
}

// turn 层事件（学自 pi 的四层 agent/turn/message/tool）。
// thinking 事件相当于 turn_start，这里补 turn_end：一轮 assistant + 工具执行完时发，
// 让前端能按轮折叠展示（"第1轮：调了2个工具 → 第2轮：生成回答"）。
function createTurnEndEvent({ step, toolCount = 0 }) {
  return { type: 'turn_end', step, toolCount };
}

function createDeltaEvent({ content }) {
  return { type: 'delta', content };
}

function createErrorEvent({ message }) {
  return { type: 'error', message };
}

function createMockFallbackEvent({ reason }) {
  return { type: 'mock_fallback', reason };
}

function createIntentEvent({
  intent, confidence, slots, jsonMode,
}) {
  return {
    type: 'intent',
    intent,
    confidence,
    slots,
    jsonMode,
  };
}

module.exports = {
  createThinkingEvent,
  createToolCallEvent,
  createToolResultEvent,
  createActionRequiredEvent,
  createFinalEvent,
  createTurnEndEvent,
  createDeltaEvent,
  createErrorEvent,
  createMockFallbackEvent,
  createIntentEvent,
};
