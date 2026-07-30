const config = require('../config');
const agentTracer = require('../observability/agentTracer');
const { getClient } = require('./llmClient');

const INTENT_VALUES = new Set([
  'greeting',
  'job_search',
  'job_recommendation',
  'job_detail',
  'favorite_job',
  'apply_job',
  'profile_advice',
  'content_search',
  'chat_history',
  'general_question',
  'unknown',
]);

const RESPONSE_FORMAT_UNSUPPORTED_PATTERNS = [
  /response_format/i,
  /json_object/i,
  /unsupported/i,
  /invalid.*parameter/i,
  /not support/i,
  /不支持/,
  /无效.*参数/,
];

let jsonModeSupported = null;

function normalizeIntent(raw = {}) {
  const intent = INTENT_VALUES.has(raw.intent) ? raw.intent : 'unknown';
  const confidence = Number(raw.confidence);
  const slots = raw.slots && typeof raw.slots === 'object' && !Array.isArray(raw.slots)
    ? raw.slots
    : {};

  return {
    intent,
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0,
    slots: {
      keyword: slots.keyword || null,
      city: slots.city || null,
      category: slots.category || null,
      workType: slots.workType || null,
      degree: slots.degree || null,
      salaryMin: Number.isFinite(Number(slots.salaryMin)) ? Number(slots.salaryMin) : null,
      jobId: Number.isFinite(Number(slots.jobId)) ? Number(slots.jobId) : null,
    },
    needsProfile: !!raw.needsProfile,
    needsConfirmation: !!raw.needsConfirmation,
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 120) : '',
  };
}

function parseJsonObject(content) {
  if (!content || typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isResponseFormatUnsupported(err) {
  const message = `${err?.message || ''} ${err?.response?.data?.error?.message || ''}`;
  return RESPONSE_FORMAT_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(message));
}

function buildMessages({ message, context = {} }) {
  return [
    {
      role: 'system',
      content: [
        'You are an intent and slot extraction module. Output valid JSON only.',
        'The JSON object must include: intent, confidence, slots, needsProfile, needsConfirmation, reason.',
        'Allowed intent values: greeting, job_search, job_recommendation, job_detail, favorite_job, apply_job, profile_advice, content_search, chat_history, general_question, unknown.',
        'slots can include keyword, city, category, workType, degree, salaryMin, jobId.',
        'Use Chinese business meaning. Do not answer the user.',
        'Example JSON: {"intent":"job_search","confidence":0.92,"slots":{"city":"深圳","category":"前端","workType":"internship","degree":null,"salaryMin":null,"keyword":null,"jobId":null},"needsProfile":false,"needsConfirmation":false,"reason":"用户想搜索深圳前端实习"}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        message,
        pageContext: {
          jobId: Number(context.jobId) || null,
        },
      }),
    },
  ];
}

async function requestIntent({ message, context, useJsonMode }) {
  const payload = {
    model: config.openai.model,
    messages: buildMessages({ message, context }),
    max_tokens: 220,
    temperature: 0,
  };
  if (useJsonMode) {
    payload.response_format = { type: 'json_object' };
  }
  const response = await getClient().chat.completions.create(payload);
  return response.choices?.[0]?.message?.content || '';
}

async function extractIntent({ message, context = {}, sessionId, runSpan }) {
  if (!config.agent.intentExtractionEnabled || !config.openai.apiKey) {
    return null;
  }

  return agentTracer.withSpan('agent.intent.extract', {
    'agent.session_id': sessionId,
    'agent.intent.json_mode': jsonModeSupported !== false,
  }, async (span) => {
    let content;
    let usedJsonMode = jsonModeSupported !== false;
    try {
      content = await requestIntent({ message, context, useJsonMode: usedJsonMode });
      if (usedJsonMode) jsonModeSupported = true;
    } catch (err) {
      if (!usedJsonMode || !isResponseFormatUnsupported(err)) throw err;
      jsonModeSupported = false;
      usedJsonMode = false;
      agentTracer.addEvent(runSpan, 'agent.intent.json_mode_disabled', { reason: err.message });
      content = await requestIntent({ message, context, useJsonMode: false });
    }

    const parsed = parseJsonObject(content);
    if (!parsed) {
      agentTracer.addEvent(runSpan, 'agent.intent.parse_failed', {
        content: agentTracer.previewText(content, 200),
      });
      return null;
    }

    const intent = normalizeIntent(parsed);
    if (span) {
      span.setAttributes({
        'agent.intent.name': intent.intent,
        'agent.intent.confidence': intent.confidence,
        'agent.intent.json_mode_used': usedJsonMode,
      });
    }
    agentTracer.addEvent(runSpan, 'agent.intent.extracted', {
      intent: intent.intent,
      confidence: intent.confidence,
      slots: intent.slots,
      jsonMode: usedJsonMode,
    });
    return { ...intent, jsonMode: usedJsonMode };
  }, {
    asType: 'generation',
    input: { message: agentTracer.previewText(message, 500), context },
  });
}

function buildIntentMessages(intent) {
  if (!intent) return [];
  return [{
    role: 'system',
    content: [
      '下面是对用户本轮输入的结构化理解,用于帮助你更稳定地选择工具,不要原样复述:',
      JSON.stringify(intent),
      '如果结构化理解和用户原文冲突,以用户原文为准。',
    ].join('\n'),
  }];
}

module.exports = {
  buildIntentMessages,
  extractIntent,
};
