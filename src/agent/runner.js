const OpenAI = require('openai');
const config = require('../config');
const { BizError } = require('../utils/response');
const { SYSTEM_PROMPT } = require('./prompt');
const memoryService = require('./memoryService');
const toolRegistry = require('./toolRegistry');
const trace = require('./traceService');
const { runMockAgent } = require('../services/mockAgent');

const MAX_STEPS = 6;
const FORCE_MOCK = String(process.env.AGENT_MOCK || '').toLowerCase() === 'true';

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    if (!config.openai.apiKey) throw BizError.badRequest('OpenAI API key 未配置');
    cachedClient = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    });
  }
  return cachedClient;
}

function buildConfirmText(name, args) {
  if (name === 'apply_job') {
    return `确认投递岗位 ${args.id} 吗？`;
  }
  return `确认执行 ${name} 吗？`;
}

function buildToolMetadata(toolCalls, extra = {}) {
  return {
    tools: toolCalls.map((call) => call.name),
    toolTraces: toolCalls.map((call) => ({
      name: call.name,
      args: call.args || {},
      status: call.error ? 'error' : (call.actionRequired ? 'action_required' : 'done'),
      summary: call.summary || null,
      error: call.error || null,
    })),
    ...extra,
  };
}

function buildContextMessages(context = {}) {
  const jobId = Number(context.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) return [];

  return [{
    role: 'system',
    content: [
      `当前用户从岗位详情页进入 Agent,页面上下文 jobId=${jobId}。`,
      `如果用户的问题与该岗位、匹配度、投递留言或收藏对比有关,优先调用 get_job_detail({"id":${jobId}}) 和 get_my_profile。`,
      '不要编造岗位信息;需要岗位事实时必须使用工具结果。',
    ].join('\n'),
  }];
}

async function runAgent({
  userId, message, context, onEvent,
}) {
  if (!message || !message.trim()) {
    throw BizError.badRequest('消息不能为空');
  }

  const sessionId = String(Date.now());
  await memoryService.saveMessage({ userId, sessionId, role: 'user', text: message });

  if (FORCE_MOCK || !config.openai.apiKey) {
    const { finalText, toolCalls } = await runMockAgent(userId, message, onEvent, context);
    await memoryService.saveMessage({
      userId,
      sessionId,
      role: 'assistant',
      text: finalText,
      metadata: toolCalls.length ? buildToolMetadata(toolCalls, { mock: true }) : { mock: true },
    });
    return { finalText, toolCalls };
  }

  const history = await memoryService.loadRecentMessages({ userId });
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...buildContextMessages(context),
    ...history,
    { role: 'user', content: message },
  ];

  const tools = toolRegistry.getToolsSchema();
  const client = getClient();
  const executedCalls = [];
  let finalText = '';

  for (let step = 0; step < MAX_STEPS; step += 1) {
    onEvent(trace.createThinkingEvent({ step }));

    let response;
    try {
      response = await client.chat.completions.create({
        model: config.openai.model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 800,
      });
    } catch (err) {
      if (step === 0) {
        console.warn('[agent] OpenAI 首步失败,切到 mock 兜底:', err.message);
        onEvent(trace.createMockFallbackEvent({ reason: err.message }));
        const { finalText: mockFinal, toolCalls: mockCalls } = await runMockAgent(userId, message, onEvent, context);
        await memoryService.saveMessage({
          userId,
          sessionId,
          role: 'assistant',
          text: mockFinal,
          metadata: buildToolMetadata(mockCalls, { mock: true, fallback: true }),
        });
        return { finalText: mockFinal, toolCalls: mockCalls };
      }
      onEvent(trace.createErrorEvent({ message: `AI 调用失败:${err.message}` }));
      throw err;
    }

    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg);

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      finalText = (assistantMsg.content || '').trim();
      break;
    }

    for (const call of assistantMsg.tool_calls) {
      const name = call.function.name;
      let args;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      onEvent(trace.createToolCallEvent({ id: call.id, name, args }));

      const tool = toolRegistry.getToolDefinition(name);
      let result;
      let errorStr;
      if (!tool) {
        errorStr = `未知工具 ${name}`;
      } else if (toolRegistry.requiresConfirmation(name, args)) {
        const actionPayload = { action: name, payload: args };
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            action_required: actionPayload,
            message: '该操作需要用户确认后才能执行',
          }),
        });
        executedCalls.push({
          name,
          args,
          result: null,
          error: null,
          actionRequired: true,
          summary: '需要用户确认',
        });
        onEvent(trace.createActionRequiredEvent({
          action: name,
          payload: args,
          confirmText: buildConfirmText(name, args),
        }));
        onEvent(trace.createToolResultEvent({
          id: call.id,
          name,
          result: actionPayload,
          summary: '需要用户确认',
        }));
        continue;
      } else {
        try {
          result = await tool.handler(args, { userId });
        } catch (err) {
          errorStr = err.message || String(err);
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: errorStr
          ? JSON.stringify({ error: errorStr })
          : JSON.stringify(toolRegistry.unwrapToolData(result)),
      });

      executedCalls.push({
        name,
        args,
        result: errorStr ? null : result,
        error: errorStr,
        summary: result?.display?.summary || errorStr || null,
      });
      onEvent(trace.createToolResultEvent({
        id: call.id,
        name,
        result,
        error: errorStr,
        summary: result?.display?.summary,
      }));
    }
  }

  if (!finalText) finalText = '(我暂时不知道怎么回答,再问一次试试?)';

  await memoryService.saveMessage({
    userId,
    sessionId,
    role: 'assistant',
    text: finalText,
    metadata: executedCalls.length ? buildToolMetadata(executedCalls) : null,
  });

  onEvent(trace.createFinalEvent({ content: finalText, toolCalls: executedCalls.length }));

  return { finalText, toolCalls: executedCalls };
}

module.exports = { runAgent };
