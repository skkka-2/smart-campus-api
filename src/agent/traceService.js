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

function createFinalEvent({ content, toolCalls = 0 }) {
  return { type: 'final', content, toolCalls };
}

function createErrorEvent({ message }) {
  return { type: 'error', message };
}

function createMockFallbackEvent({ reason }) {
  return { type: 'mock_fallback', reason };
}

module.exports = {
  createThinkingEvent,
  createToolCallEvent,
  createToolResultEvent,
  createActionRequiredEvent,
  createFinalEvent,
  createErrorEvent,
  createMockFallbackEvent,
};
