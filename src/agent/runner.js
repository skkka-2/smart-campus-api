const config = require('../config');
const { BizError } = require('../utils/response');
const { SYSTEM_PROMPT } = require('./prompt');
const memoryService = require('./memoryService');
const toolRegistry = require('./toolRegistry');
const trace = require('./traceService');
const agentTracer = require('../observability/agentTracer');
const { runMockAgent } = require('../services/mockAgent');
const { getClient } = require('./llmClient');
const { buildIntentMessages, extractIntent } = require('./intentExtractor');
const { validateToolArguments } = require('./toolValidator');

const MAX_STEPS = 6;
const FORCE_MOCK = String(process.env.AGENT_MOCK || '').toLowerCase() === 'true';

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

function applyToolCallDelta(toolCalls, deltaCall) {
  const index = deltaCall.index ?? toolCalls.length;
  if (!toolCalls[index]) {
    toolCalls[index] = {
      id: deltaCall.id || '',
      type: deltaCall.type || 'function',
      function: { name: '', arguments: '' },
    };
  }

  const target = toolCalls[index];
  if (deltaCall.id) target.id = deltaCall.id;
  if (deltaCall.type) target.type = deltaCall.type;
  if (deltaCall.function?.name) target.function.name += deltaCall.function.name;
  if (deltaCall.function?.arguments) target.function.arguments += deltaCall.function.arguments;
}

async function createStreamingCompletion({
  client, messages, tools, onDelta, sessionId, runSpan, signal,
}) {
  return agentTracer.withSpan('gen_ai.chat.completions', {
    'agent.session_id': sessionId,
    'gen_ai.system': config.openai.provider,
    'gen_ai.request.model': config.openai.model,
    'gen_ai.request.max_tokens': 800,
    'gen_ai.request.message_count': messages.length,
    'agent.tool.schema_count': tools.length,
    'gen_ai.request.stream': true,
  }, async (span) => {
    const stream = await client.chat.completions.create({
      model: config.openai.model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 800,
      stream: true,
    }, { signal });

    let content = '';
    let finishReason = null;
    const toolCalls = [];

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta || {};
      if (delta.content) {
        content += delta.content;
        onDelta(delta.content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const deltaCall of delta.tool_calls) {
          applyToolCallDelta(toolCalls, deltaCall);
        }
      }
    }

    const normalizedToolCalls = toolCalls
      .filter((call) => call?.function?.name)
      .map((call, index) => ({
        id: call.id || `tool_call_${Date.now()}_${index}`,
        type: call.type || 'function',
        function: {
          name: call.function.name,
          arguments: call.function.arguments || '{}',
        },
      }));

    if (span) {
      span.setAttributes({
        'gen_ai.response.finish_reason': finishReason || '',
        'gen_ai.response.content_length': content.length,
        'agent.tool.call_count': normalizedToolCalls.length,
      });
    }
    agentTracer.addEvent(runSpan, 'agent.generation_stream_done', {
      finishReason,
      contentLength: content.length,
      toolCalls: normalizedToolCalls.length,
    });

    return {
      message: {
        role: 'assistant',
        content: content || null,
        ...(normalizedToolCalls.length ? { tool_calls: normalizedToolCalls } : {}),
      },
      finishReason,
    };
  }, {
    asType: 'generation',
  });
}

async function runAgent({
  userId, message, context, onEvent, signal,
}) {
  if (!message || !message.trim()) {
    throw BizError.badRequest('消息不能为空');
  }

  const sessionId = String(Date.now());
  const mock = FORCE_MOCK || !config.openai.apiKey;
  return agentTracer.withAgentRun({
    userId, sessionId, message, context, mock,
  }, (runSpan) => runAgentWithSession({
    userId, message, context, onEvent, sessionId, runSpan, signal,
  }));
}

async function runAgentWithSession({
  userId, message, context, onEvent, sessionId, runSpan, signal,
}) {
  await memoryService.saveMessage({ userId, sessionId, role: 'user', text: message });

  if (FORCE_MOCK || !config.openai.apiKey) {
    agentTracer.addEvent(runSpan, 'agent.mock_start');
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

  const history = await agentTracer.withSpan('agent.memory.load', {
    'agent.session_id': sessionId,
    'agent.user_id_hash': require('../observability/redactor').hashUserId(userId),
  }, () => memoryService.loadRecentMessages({ userId }));
  const intent = await extractIntent({
    userId,
    message,
    context,
    sessionId,
    runSpan,
  }).catch((err) => {
    console.warn('[agent] intent extraction skipped:', err.message);
    agentTracer.addEvent(runSpan, 'agent.intent.error', { message: err.message });
    return null;
  });
  if (intent) {
    onEvent(trace.createIntentEvent({
      intent: intent.intent,
      confidence: intent.confidence,
      slots: intent.slots,
      jsonMode: intent.jsonMode,
    }));
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...buildContextMessages(context),
    ...buildIntentMessages(intent),
    ...history,
    { role: 'user', content: message },
  ];

  const tools = toolRegistry.getToolsSchema();
  const client = getClient();
  const executedCalls = [];
  let finalText = '';

  // 工具未找到 / 参数校验失败时统一回错给模型。
  // 闭包捕获 messages / executedCalls / onEvent / runSpan，避免参数列表过长。
  function emitToolError(call, errorMessage) {
    const name = call.function.name;
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify({ error: errorMessage }),
    });
    executedCalls.push({
      name,
      args: null,
      result: null,
      error: errorMessage,
      summary: errorMessage,
    });
    onEvent(trace.createToolResultEvent({
      id: call.id,
      name,
      result: null,
      error: errorMessage,
      summary: errorMessage,
    }));
    agentTracer.addEvent(runSpan, 'agent.tool_result', {
      tool: name,
      ok: false,
      summary: errorMessage,
    });
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    // ① 每轮开头检查中断（学自 pi agent-loop.ts 的 signal 检查点）
    if (signal?.aborted) break;

    onEvent(trace.createThinkingEvent({ step }));
    agentTracer.addEvent(runSpan, 'agent.thinking', { step });

    let completion;
    try {
      completion = await createStreamingCompletion({
        client,
        messages,
        tools,
        sessionId,
        runSpan,
        signal,
        onDelta(delta) {
          finalText += delta;
          onEvent(trace.createDeltaEvent({ content: delta }));
        },
      });
    } catch (err) {
      // 中断不是错误：不报错、不走 mock fallback、不发 error 事件
      // （学自 pi/openclaw：AbortError 要和真实错误区分，否则会误触发兜底）
      if (err.name === 'AbortError' || signal?.aborted) {
        agentTracer.addEvent(runSpan, 'agent.aborted', { step });
        break;
      }
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
      agentTracer.addEvent(runSpan, 'agent.error', { message: err.message });
      throw err;
    }

    const assistantMsg = completion.message;
    messages.push(assistantMsg);

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      finalText = (assistantMsg.content || finalText || '').trim();
      break;
    }

    for (const call of assistantMsg.tool_calls) {
      // ③ 每个工具执行前检查中断
      if (signal?.aborted) break;

      const id = call.id;
      const name = call.function.name;
      const tool = toolRegistry.getToolDefinition(name);

      // ① 工具不存在：直接回错，不执行 handler
      if (!tool) {
        emitToolError(call, `未知工具 ${name}`);
        continue;
      }

      // ② 参数校验：失败把带字段路径的错误回给模型，让它重发
      //    （学自 pi 的 validateToolArguments，旧的 catch { args = {} } 在此废弃）
      let args;
      try {
        args = validateToolArguments(tool, call.function.arguments);
      } catch (err) {
        emitToolError(call, err.message);
        continue;
      }

      onEvent(trace.createToolCallEvent({ id, name, args }));
      agentTracer.addEvent(runSpan, 'agent.tool_call', {
        tool: name,
        args: agentTracer.summarizeToolArgs(args),
      });

      let result;
      let errorStr;
      if (toolRegistry.requiresConfirmation(name, args)) {
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
          result = await agentTracer.withSpan(`agent.tool.${name}`, {
            'agent.session_id': sessionId,
            'agent.tool.name': name,
            'agent.tool.args': agentTracer.summarizeToolArgs(args),
          }, async (span) => {
            const toolResult = await tool.handler(args, { userId });
            span.setAttributes({
              'agent.tool.ok': toolResult?.ok !== false,
              'agent.tool.summary': toolResult?.display?.summary || '',
            });
            return toolResult;
          });
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
      agentTracer.addEvent(runSpan, 'agent.tool_result', {
        tool: name,
        ok: !errorStr,
        summary: result?.display?.summary || errorStr || '',
      });
    }
  }

  // 中断分支：客户端已断开，不发 final 事件（收不到），但保存一条 aborted 消息。
  // 学自 pi/openclaw：transcript 末尾不能留孤立的 tool_call（无配对 tool_result），
  // 否则下次续跑 OpenAI API 直接报错。
  if (signal?.aborted) {
    await memoryService.saveMessage({
      userId,
      sessionId,
      role: 'assistant',
      text: finalText || '(已中断)',
      metadata: { aborted: true, toolCalls: executedCalls.length },
    });
    agentTracer.addEvent(runSpan, 'agent.final', {
      aborted: true,
      toolCalls: executedCalls.length,
    });
    return { finalText, toolCalls: executedCalls, aborted: true };
  }

  if (!finalText) finalText = '(我暂时不知道怎么回答,再问一次试试?)';

  await memoryService.saveMessage({
    userId,
    sessionId,
    role: 'assistant',
    text: finalText,
    metadata: executedCalls.length ? buildToolMetadata(executedCalls) : null,
  });

  const traceContext = agentTracer.getTraceContext();
  agentTracer.updateCurrentObservation({
    output: agentTracer.previewText(finalText, 800),
    metadata: {
      toolCalls: executedCalls.length,
      outputLength: finalText.length,
    },
  }, 'agent');
  onEvent(trace.createFinalEvent({
    content: finalText,
    toolCalls: executedCalls.length,
    traceContext,
  }));
  agentTracer.addEvent(runSpan, 'agent.final', {
    toolCalls: executedCalls.length,
    outputLength: finalText.length,
    trace: traceContext,
  });

  return { finalText, toolCalls: executedCalls };
}

module.exports = { runAgent };
