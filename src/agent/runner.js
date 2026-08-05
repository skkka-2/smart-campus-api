const config = require('../config');
const { BizError } = require('../utils/response');
const { SYSTEM_PROMPT } = require('./prompt');
const memoryService = require('./memoryService');
const toolRegistry = require('./toolRegistry');
const safetyPolicy = require('./safetyPolicy');
const trace = require('./traceService');
const agentTracer = require('../observability/agentTracer');
const { runMockAgent } = require('../services/mockAgent');
const { getClient } = require('./llmClient');
const { buildIntentMessages, extractIntent } = require('./intentExtractor');
const { validateToolArguments } = require('./toolValidator');
const { estimateContextTokens, estimateText, shouldCompact } = require('./tokenBudget');
const {
  truncateOldToolResults,
  findCompactionCutPoint,
  buildSummaryPrompt,
  assembleCompactedHistory,
} = require('./contextManager');
const { redactSecrets } = require('../observability/secretRedaction');
const agentEventRepository = require('../repositories/agentEventRepository');

// 脱敏错误信息：防止 SDK error message 里的 api_key 泄漏到日志/前端/模型。
const safeErr = (err) => redactSecrets(err?.message || String(err));

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

// P2-2c：摘要压缩。调一次 LLM 把旧历史总结成结构化摘要，重组 messages。
// 学自 grok-build full-replace + assemble 顺序。失败不致命——原 messages 不变，继续跑。
async function compactHistory({ client, messages, signal, runSpan }) {
  const contextWindow = config.openai.contextWindow;
  // 保留最近 keepRecentTokens 的原文，其余摘要
  const keepRecentTokens = Math.floor(contextWindow * 0.25);
  const { cutIndex } = findCompactionCutPoint(messages, keepRecentTokens, estimateText);
  if (cutIndex <= 0) return false; // 没什么可压缩的

  const toSummarize = messages.slice(0, cutIndex);
  const recent = messages.slice(cutIndex);
  // system + context 类消息（role=system）单独拎出来放前面
  const systemMessages = toSummarize.filter((m) => m.role === 'system');
  const nonSystemToSummarize = toSummarize.filter((m) => m.role !== 'system');

  const prompt = buildSummaryPrompt(nonSystemToSummarize);
  agentTracer.addEvent(runSpan, 'agent.compaction_start', {
    messagesBefore: messages.length,
    cutIndex,
    keepRecentTokens,
  });

  try {
    const resp = await client.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: 'system', content: '你是会话压缩助手，只输出结构化摘要。' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 800,
    }, { signal });
    const summary = resp.choices?.[0]?.message?.content || '';
    if (!summary) return false;

    // 重组：[system+context, recent, 摘要(最末)]
    const assembled = assembleCompactedHistory({ systemMessages, recentMessages: recent, summary });
    messages.length = 0;
    messages.push(...assembled);
    agentTracer.addEvent(runSpan, 'agent.compaction_done', {
      messagesAfter: messages.length,
      summaryLength: summary.length,
    });
    return true;
  } catch (err) {
    // 压缩失败不致命：原 messages 不变，继续跑（学自 pi 的"宁可慢也不要崩"）
    if (err.name === 'AbortError' || signal?.aborted) throw err;
    agentTracer.addEvent(runSpan, 'agent.compaction_failed', { message: safeErr(err) });
    console.warn('[agent] compaction failed, keep original messages:', safeErr(err));
    return false;
  }
}

async function createStreamingCompletion({
  client, messages, tools, onDelta, sessionId, runSpan, signal,
}) {
  return agentTracer.withSpan('gen_ai.chat.completions', {
    'agent.session_id': sessionId,
    'gen_ai.system': config.openai.provider,
    'gen_ai.request.model': config.openai.model,
    'gen_ai.request.max_tokens': 2000,
    'gen_ai.request.message_count': messages.length,
    'agent.tool.schema_count': tools.length,
    'gen_ai.request.stream': true,
  }, async (span) => {
    const stream = await client.chat.completions.create({
      model: config.openai.model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 2000,
      stream: true,
      // 流式拿 usage 必须开。chatanywhere/openai 支持；zhipu_glm 等可能忽略——
      // 忽略时 usage 为 null，调用方走纯估算降级（tokenBudget.estimateContextTokens 已处理）。
      stream_options: { include_usage: true },
    }, { signal });

    let content = '';
    let finishReason = null;
    let usage = null;
    const toolCalls = [];

    for await (const chunk of stream) {
      // usage 在最后一个 chunk（choices 为空的那条）
      if (chunk.usage) usage = chunk.usage;

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
        // 有 usage 用真实值，没有就 null（Langfuse 上能看到 provider 是否支持）
        'gen_ai.usage.prompt_tokens': usage?.prompt_tokens ?? null,
        'gen_ai.usage.completion_tokens': usage?.completion_tokens ?? null,
        'gen_ai.usage.total_tokens': usage?.total_tokens ?? null,
      });
    }
    agentTracer.addEvent(runSpan, 'agent.generation_stream_done', {
      finishReason,
      contentLength: content.length,
      toolCalls: normalizedToolCalls.length,
      hasUsage: !!usage,
    });

    return {
      message: {
        role: 'assistant',
        content: content || null,
        ...(normalizedToolCalls.length ? { tool_calls: normalizedToolCalls } : {}),
      },
      finishReason,
      usage,
    };
  }, {
    asType: 'generation',
  });
}

async function runAgent({
  userId, message, context, onEvent, signal, sessionId,
}) {
  if (!message || !message.trim()) {
    throw BizError.badRequest('消息不能为空');
  }

  // sessionId 由前端生成传入（语义：一次对话）。
  // 缺失则后端兜底生成，保证旧前端也能工作。
  const resolvedSessionId = sessionId || `gen-${Date.now()}`;
  const mock = FORCE_MOCK || !config.openai.apiKey;
  return agentTracer.withAgentRun({
    userId, sessionId: resolvedSessionId, message, context, mock,
  }, (runSpan) => runAgentWithSession({
    userId, message, context, onEvent, sessionId: resolvedSessionId, runSpan, signal,
  }));
}

async function runAgentWithSession({
  userId, message, context, onEvent, sessionId, runSpan, signal,
}) {
  // P3-2b：事件双写。包一层 onEvent，发 SSE 事件的同时排队写 agent_events。
  // 只录关键事件（不录 delta——每个 token 一个，写 DB 会爆，且回放时用 final 文本即可）。
  // 学自 pi 的 SessionEntry：事件是 agent 状态变更的完整轨迹，可回放。
  // seq 由 repository 在数据库锁内分配；这里保证同一 run 的事件按 emit 顺序落库。
  const RECORDED_TYPES = new Set([
    'message', 'thinking', 'tool_call', 'tool_result', 'action_required',
    'intent', 'turn_end', 'final', 'error', 'mock_fallback', 'compaction',
  ]);
  let eventWriteChain = Promise.resolve();

  function flushEventWrites() {
    return eventWriteChain;
  }

  const emit = (event) => {
    onEvent(event);
    if (RECORDED_TYPES.has(event.type)) {
      // 排队但不阻塞主循环；各返回路径会 flush，保证请求结束前已完成提交。
      eventWriteChain = eventWriteChain
        .then(() => agentEventRepository.append({
          sessionId, userId, type: event.type, payload: event,
        }))
        .catch((err) => {
          // 事件落库失败不影响 Agent 主流程，但必须允许后续事件继续写。
          console.warn('[agent] event append failed:', safeErr(err));
        });
    }
  };

  // 先加载历史（不含当前消息），再存当前消息——避免当前 user message 重复进上下文。
  // 之前 saveMessage 在 loadRecent 前，导致 loadRecent 读到刚存的当前消息，
  // 而 messages 数组末尾又 append 一次 → 当前问题出现两遍。
  const history = await agentTracer.withSpan('agent.memory.load', {
    'agent.session_id': sessionId,
    'agent.user_id_hash': require('../observability/redactor').hashUserId(userId),
  }, () => memoryService.loadRecentMessages({ userId, sessionId }));

  await memoryService.saveMessage({ userId, sessionId, role: 'user', text: message });
  // 录一条 user message 事件（回放时重建用户气泡用；实时流前端 onEvent 不处理 message 类型，会被忽略）
  emit({ type: 'message', role: 'user', content: message });

  if (FORCE_MOCK || !config.openai.apiKey) {
    agentTracer.addEvent(runSpan, 'agent.mock_start');
    const { finalText, toolCalls } = await runMockAgent(userId, message, emit, context);
    await memoryService.saveMessage({
      userId,
      sessionId,
      role: 'assistant',
      text: finalText,
      metadata: toolCalls.length ? buildToolMetadata(toolCalls, { mock: true }) : { mock: true },
    });
    await flushEventWrites();
    return { finalText, toolCalls };
  }

  const intent = await extractIntent({
    userId,
    message,
    context,
    sessionId,
    runSpan,
  }).catch((err) => {
    console.warn('[agent] intent extraction skipped:', safeErr(err));
    agentTracer.addEvent(runSpan, 'agent.intent.error', { message: safeErr(err) });
    return null;
  });
  if (intent) {
    emit(trace.createIntentEvent({
      intent: intent.intent,
      confidence: intent.confidence,
      slots: intent.slots,
      jsonMode: intent.jsonMode,
    }));
  }
  // 排序原则（学自 grok-build 的 KV-cache 前缀稳定性）：越稳定的越靠前。
  // 之前 buildIntentMessages 插在 history 之前，intent 每轮变化 → 它后面的 history 全部 cache miss。
  // 现在把动态内容移到尾部：稳定前缀 [system, context, history] + 动态尾部 [intent, user]。
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...buildContextMessages(context),
    ...history,
    ...buildIntentMessages(intent),
    { role: 'user', content: message },
  ];

  const tools = toolRegistry.getToolsSchema();
  const client = getClient();
  const executedCalls = [];
  let finalText = '';

  // 记录最后一次 API 真实 usage 及其对应的 messages 下标，供混合估算用（P1-2）。
  let lastUsage = null;
  let lastUsageIndex = null;

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
    emit(trace.createToolResultEvent({
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

  // 执行单个已校验的非 confirm 工具，返回 { result, errorStr }。
  // 内部捕获所有异常转成 errorStr，不往外抛（保证 Promise.all 不被一个工具打挂）。
  // 学自 pi 的 finalizeExecutedToolCall 捕获所有异常。
  async function executeOneTool(tool, args, call, userId, sessionId) {
    try {
      const result = await agentTracer.withSpan(`agent.tool.${tool.name}`, {
        'agent.session_id': sessionId,
        'agent.tool.name': tool.name,
        'agent.tool.args': agentTracer.summarizeToolArgs(args),
      }, async (span) => {
        const toolResult = await tool.handler(args, { userId });
        span.setAttributes({
          'agent.tool.ok': toolResult?.ok !== false,
          'agent.tool.summary': toolResult?.display?.summary || '',
        });
        return toolResult;
      });
      return { result, errorStr: null };
    } catch (err) {
      return { result: null, errorStr: safeErr(err) };
    }
  }

  // 工具执行后的统一收尾：push tool_result message + executedCalls + 事件（保证顺序）。
  function finalizeToolResult(call, name, args, result, errorStr) {
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
    emit(trace.createToolResultEvent({
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

  for (let step = 0; step < MAX_STEPS; step += 1) {
    // ① 每轮开头检查中断（学自 pi agent-loop.ts 的 signal 检查点）
    if (signal?.aborted) break;

    // P2-2a：截断旧 tool result。最近 2 轮保留全文，更旧的替换成提示性摘要。
    // 学自 openclaw 四态路由的"先截断后摘要"：免费、近乎无损（旧岗位列表本来就没用了）。
    // 短对话无影响（没有超过 2 轮的旧 tool result）。
    truncateOldToolResults(messages, { keepRounds: 2 });

    // P2-2b/c：截断后若仍超阈值，调 LLM 摘要压缩。
    // shouldCompact 含两段夹取防小窗口死循环（学 openclaw agent-settings.ts:52）。
    const contextTokensBefore = estimateContextTokens(messages, lastUsage, lastUsageIndex);
    if (shouldCompact(contextTokensBefore, config.openai.contextWindow)) {
      const compacted = await compactHistory({ client, messages, signal, runSpan });
      if (compacted) {
        // 压缩后重置 usage 基准（历史变了，旧 usage 不再适用）
        lastUsage = null;
        lastUsageIndex = null;
      }
    }

    emit(trace.createThinkingEvent({ step }));
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
          emit(trace.createDeltaEvent({ content: delta }));
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
        console.warn('[agent] OpenAI 首步失败,切到 mock 兜底:', safeErr(err));
        emit(trace.createMockFallbackEvent({ reason: safeErr(err) }));
        const { finalText: mockFinal, toolCalls: mockCalls } = await runMockAgent(userId, message, emit, context);
        await memoryService.saveMessage({
          userId,
          sessionId,
          role: 'assistant',
          text: mockFinal,
          metadata: buildToolMetadata(mockCalls, { mock: true, fallback: true }),
        });
        await flushEventWrites();
        return { finalText: mockFinal, toolCalls: mockCalls };
      }
      emit(trace.createErrorEvent({ message: `AI 调用失败:${safeErr(err)}` }));
      agentTracer.addEvent(runSpan, 'agent.error', { message: safeErr(err) });
      await flushEventWrites();
      throw err;
    }

    const assistantMsg = completion.message;
    messages.push(assistantMsg);

    // P1-2：记录真实 usage，估算当前上下文 token，写进 span 供 Langfuse 观测。
    // 混合估算：真实 prompt_tokens（基准）+ 之后新增消息的估算。
    // provider 不支持 stream_options 时 usage 为 null，走纯估算降级。
    if (completion.usage?.prompt_tokens != null) {
      lastUsage = completion.usage;
      lastUsageIndex = messages.length - 1;
    }
    const contextTokens = estimateContextTokens(messages, lastUsage, lastUsageIndex);
    agentTracer.addEvent(runSpan, 'agent.context_budget', {
      contextTokens,
      hasRealUsage: !!lastUsage,
      promptTokens: lastUsage?.prompt_tokens ?? null,
    });

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      finalText = (assistantMsg.content || finalText || '').trim();
      break;
    }

    // 截断检测：finish_reason === 'length' 表示输出撞 max_tokens 被截断。
    // 流式拼出来的 tool_call arguments 可能恰好还是合法 JSON、也能通过 schema 校验，
    // 但语义上是残缺的（如 apply_job 的 message 被截在半句）。
    // 学自 pi agent-loop.ts:212 的 failToolCallsFromTruncatedMessage：整批失败回错，
    // 让模型用完整参数重发，不执行可能残缺的调用。
    if (completion.finishReason === 'length') {
      const truncMsg = (name) =>
        `工具调用 "${name}" 未执行：本次输出触达 token 上限，参数可能被截断。请用完整参数重新调用。`;
      for (const call of assistantMsg.tool_calls) {
        emitToolError(call, truncMsg(call.function.name));
      }
      continue;
    }

    // ===== 工具执行：三阶段（学自 pi agent-loop.ts:489）=====
    // 阶段1 串行准备（校验+确认门控）→ 阶段2 决定模式 → 阶段3 执行+串行收尾
    const toolCalls = assistantMsg.tool_calls;

    // 阶段1：串行准备。immediate 的（错误/confirm）当场处理；execute 的收集起来。
    const toExecute = []; // { call, tool, args }
    for (const call of toolCalls) {
      if (signal?.aborted) break;
      const id = call.id;
      const name = call.function.name;
      const tool = toolRegistry.getToolDefinition(name);

      if (!tool) {
        emitToolError(call, `未知工具 ${name}`);
        continue;
      }

      let args;
      try {
        args = validateToolArguments(tool, call.function.arguments);
      } catch (err) {
        emitToolError(call, safeErr(err));
        continue;
      }

      emit(trace.createToolCallEvent({ id, name, args }));
      agentTracer.addEvent(runSpan, 'agent.tool_call', {
        tool: name,
        args: agentTracer.summarizeToolArgs(args),
      });

      if (toolRegistry.requiresConfirmation(name, args)) {
        // confirm 工具：不执行，发 action_required，当场收尾
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
          name, args, result: null, error: null,
          actionRequired: true, summary: '需要用户确认',
        });
        emit(trace.createActionRequiredEvent({
          action: name, payload: args, confirmText: buildConfirmText(name, args),
        }));
        emit(trace.createToolResultEvent({
          id: call.id, name, result: actionPayload, summary: '需要用户确认',
        }));
        continue;
      }

      toExecute.push({ call, tool, args });
    }

    // 阶段2：决定执行模式。任一工具 sequential → 整批串行（学自 pi agent-loop.ts:419）。
    const hasSequential = toExecute.some(
      ({ tool }) => safetyPolicy.getExecutionMode(tool.name) === 'sequential',
    );

    // 阶段3：执行 + 串行收尾。
    // 串行：逐个 await；并行：Promise.all（executeOneTool 内部已捕获异常，不会 reject）。
    const results = hasSequential
      ? await runSequential(toExecute)
      : await Promise.all(toExecute.map((item) => runOne(item)));

    async function runOne({ call, tool, args }) {
      if (signal?.aborted) return { call, name: tool.name, args, result: null, errorStr: 'aborted' };
      const { result, errorStr } = await executeOneTool(tool, args, call, userId, sessionId);
      return { call, name: tool.name, args, result, errorStr };
    }
    async function runSequential(items) {
      const out = [];
      for (const item of items) {
        if (signal?.aborted) break;
        out.push(await runOne(item));
      }
      return out;
    }

    // 串行收尾：按原顺序 push messages + executedCalls + 事件（顺序稳定，保 prompt cache）
    for (const r of results) {
      if (!r) continue;
      finalizeToolResult(r.call, r.name, r.args, r.result, r.errorStr);
    }

    // P3-1：一轮工具执行完，发 turn_end（前端可按轮折叠展示）
    emit(trace.createTurnEndEvent({ step, toolCount: executedCalls.length }));
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
    await flushEventWrites();
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
  emit(trace.createFinalEvent({
    content: finalText,
    toolCalls: executedCalls.length,
    traceContext,
  }));
  agentTracer.addEvent(runSpan, 'agent.final', {
    toolCalls: executedCalls.length,
    outputLength: finalText.length,
    trace: traceContext,
  });

  await flushEventWrites();
  return { finalText, toolCalls: executedCalls };
}

module.exports = { runAgent };
