const {
  SpanStatusCode,
  context: otelContext,
  trace,
} = require('@opentelemetry/api');
const {
  propagateAttributes,
  startActiveObservation,
  updateActiveObservation,
} = require('@langfuse/tracing');
const config = require('../config');
const redactor = require('./redactor');

function normalizeAttributes(attributes = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value;
    } else {
      normalized[key] = redactor.safeJson(value);
    }
  }
  return normalized;
}

function stringifyAttributes(attributes = {}) {
  const normalized = normalizeAttributes(attributes);
  return Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [key, String(value)]),
  );
}

function inferObservationType(name) {
  if (name === 'agent.run') return 'agent';
  if (name.startsWith('agent.tool.')) return 'tool';
  if (name.startsWith('gen_ai.')) return 'generation';
  return 'span';
}

async function withSpan(name, attributes, fn, options = {}) {
  const asType = options.asType || inferObservationType(name);
  return startActiveObservation(name, async (observation) => {
    const span = observation.otelSpan || trace.getActiveSpan();
    if (span) span.setAttributes(normalizeAttributes(attributes));
    observation.update?.({
      ...(options.input != null ? { input: options.input } : {}),
      ...(options.output != null ? { output: options.output } : {}),
      metadata: normalizeAttributes(attributes),
    });
    try {
      const result = await fn(span);
      if (span) span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      if (span) {
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });
      }
      throw err;
    }
  }, { asType });
}

async function withAgentRun({
  userId, sessionId, message, context = {}, mock = false,
}, fn) {
  const promptStats = redactor.getPromptStats(message);
  const userIdHash = redactor.hashUserId(userId);
  const attributes = {
    'agent.name': 'smart-campus-agent',
    'agent.session_id': sessionId,
    'agent.user_id_hash': userIdHash,
    'agent.context.job_id': Number(context.jobId) || undefined,
    'agent.prompt.length': promptStats.length,
    'agent.prompt.has_job_intent': promptStats.hasJobIntent,
    'agent.prompt.has_apply_intent': promptStats.hasApplyIntent,
    'agent.mock': mock,
    'gen_ai.system': config.openai.provider,
    'gen_ai.request.model': config.openai.model,
  };

  return withSpan('agent.run', attributes, (span) => propagateAttributes({
    userId: userIdHash,
    sessionId,
    traceName: 'smart-campus-agent',
    tags: [
      'smart-campus',
      `provider:${config.openai.provider}`,
      `model:${config.openai.model}`,
      mock ? 'mock' : 'llm',
    ],
    metadata: stringifyAttributes(attributes),
  }, () => fn(span)), {
    asType: 'agent',
    input: {
      message: redactor.previewText(message),
      context: Number(context.jobId) ? { jobId: Number(context.jobId) } : undefined,
    },
  });
}

function getTraceContext() {
  const span = trace.getSpan(otelContext.active());
  const spanContext = span?.spanContext();
  if (!spanContext) return null;
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

function addEvent(span, name, attributes = {}) {
  if (!span) return;
  span.addEvent(name, normalizeAttributes(attributes));
}

function updateCurrentObservation(attributes, asType = 'span') {
  updateActiveObservation(attributes, { asType });
}

module.exports = {
  addEvent,
  getTraceContext,
  previewText: redactor.previewText,
  summarizeToolArgs: redactor.summarizeToolArgs,
  updateCurrentObservation,
  withAgentRun,
  withSpan,
};
