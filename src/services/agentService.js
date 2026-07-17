/**
 * Agent 服务
 * ==================================================================
 * runAgent(userId, userMessage, onEvent) → Promise<{ finalText, toolCalls }>
 *
 * 内部多轮 OpenAI function calling 循环:
 *   1. 先送出 [system, ...history, user] → GPT
 *   2. GPT 返回 tool_calls 或 content
 *   3. 若 tool_calls,依次执行,把 tool result 塞回 messages
 *   4. 重复直到 GPT 返回纯 content 或达到 MAX_STEPS
 *
 * onEvent(event) 是流式回调,event 形如:
 *   { type: 'thinking' }
 *   { type: 'tool_call', name, arguments }
 *   { type: 'tool_result', name, result | error }
 *   { type: 'delta', content }         (可选:未来接 streaming 用)
 *   { type: 'final', content }
 *   { type: 'error', message }
 */

const OpenAI = require('openai');
const config = require('../config');
const chatMessageRepository = require('../repositories/chatMessageRepository');
const { toOpenAITools, getTool } = require('./agentTools');
const { runMockAgent } = require('./mockAgent');
const { BizError } = require('../utils/response');

const MAX_STEPS = 6;
const MAX_HISTORY = 20;

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

const SYSTEM_PROMPT = `你是"智学助手"—— 一个为大学生服务的实习/就业规划 agent,内置在一个校园平台里。
你的核心目标是根据用户当下的画像和数据,给出**具体、可执行、不含空话**的建议。

工作方式:
1. 除非用户只是打招呼,否则先调用 get_my_profile 或 recommend_jobs 了解用户和数据后再回答。
2. 当用户询问"推荐/最适合我"时,优先用 recommend_jobs;询问"帮我搜"时,用 list_jobs。
3. 要看某个具体岗位的详细要求/福利,调 get_job_detail 拿完整字段。
4. 只有用户明确要求"投递""帮我投"时,才调 apply_job。收藏 favorite_job 相对安全,主动帮忙也 ok。
5. 若用户画像不完整(major/career_direction/interests 缺),礼貌提示他去 /profile 补齐,并暂时以泛用建议兜底。
6. 回复用中文,风格简洁、专业、带一点鼓励感。**避免"以下是一些建议"这种套话**。
7. 输出中引用岗位时,格式:「**公司 · 岗位名**」,便于用户识别。

限制:
- 不要编造岗位或数据 —— 只用工具真实返回的。
- 一轮对话中同一个工具至多调 2 次(如需要多结果,合并到一次 list_jobs 里)。
- 每次思考完就动手,不要口头描述"我打算调用..."`;

/** 拉最近 MAX_HISTORY 条对话作为 context */
async function loadHistory(userId) {
  const rows = await chatMessageRepository.listByUser(userId);
  const recent = rows.slice(-MAX_HISTORY);
  // chatmessages 里我们只存 user / assistant 两种 role 的对话,tool 步骤不进历史(否则 context 爆)
  const messages = [];
  for (const r of recent) {
    if (r.type === 'user') messages.push({ role: 'user', content: r.text });
    else if (r.type === 'assistant' || r.type === 'ai') messages.push({ role: 'assistant', content: r.text });
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

/**
 * 主入口
 * @param {number} userId
 * @param {string} userMessage
 * @param {(event: object) => void} onEvent
 */
async function runAgent(userId, userMessage, onEvent) {
  if (!userMessage || !userMessage.trim()) {
    throw BizError.badRequest('消息不能为空');
  }

  const sessionId = String(Date.now());
  await saveMessage({ userId, sessionId, role: 'user', text: userMessage });

  // Mock 分支:环境变量强制 或 没配 openai key
  if (FORCE_MOCK || !config.openai.apiKey) {
    const { finalText, toolCalls } = await runMockAgent(userId, userMessage, onEvent);
    await saveMessage({
      userId, sessionId, role: 'assistant', text: finalText,
      metadata: toolCalls.length ? { tools: toolCalls.map((c) => c.name), mock: true } : { mock: true },
    });
    return { finalText, toolCalls };
  }

  // 组装 messages
  const history = await loadHistory(userId);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const tools = toOpenAITools();
  const client = getClient();

  const executedCalls = [];
  let finalText = '';

  for (let step = 0; step < MAX_STEPS; step += 1) {
    onEvent({ type: 'thinking', step });

    let resp;
    try {
      resp = await client.chat.completions.create({
        model: config.openai.model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 800,
      });
    } catch (err) {
      // 第一步就报错(通常是 OpenAI 服务不可用)→ 无缝切到 mock,demo 不打断
      if (step === 0) {
        console.warn('[agent] OpenAI 首步失败,切到 mock 兜底:', err.message);
        onEvent({ type: 'mock_fallback', reason: err.message });
        const { finalText: mockFinal, toolCalls: mockCalls } = await runMockAgent(userId, userMessage, onEvent);
        await saveMessage({
          userId, sessionId, role: 'assistant', text: mockFinal,
          metadata: { tools: mockCalls.map((c) => c.name), mock: true, fallback: true },
        });
        return { finalText: mockFinal, toolCalls: mockCalls };
      }
      onEvent({ type: 'error', message: `AI 调用失败:${err.message}` });
      throw err;
    }

    const choice = resp.choices[0];
    const assistantMsg = choice.message;
    // 把 assistant message(含 tool_calls)塞回 messages,便于下一轮
    messages.push(assistantMsg);

    // 无工具调用 → 收工
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      finalText = (assistantMsg.content || '').trim();
      break;
    }

    // 有工具调用 → 依次执行
    for (const call of assistantMsg.tool_calls) {
      const name = call.function.name;
      let args = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      onEvent({ type: 'tool_call', id: call.id, name, arguments: args });

      const tool = getTool(name);
      let result;
      let errorStr;
      if (!tool) {
        errorStr = `未知工具 ${name}`;
      } else {
        try {
          result = await tool.handler(args, { userId });
        } catch (err) {
          errorStr = err.message || String(err);
        }
      }

      // 结果打包给 LLM
      const toolResultContent = errorStr
        ? JSON.stringify({ error: errorStr })
        : JSON.stringify(result);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: toolResultContent,
      });

      executedCalls.push({ name, args, result: errorStr ? null : result, error: errorStr });

      onEvent({
        type: 'tool_result',
        id: call.id,
        name,
        result: errorStr ? null : result,
        error: errorStr,
      });
    }
  }

  if (!finalText) finalText = '(我暂时不知道怎么回答,再问一次试试?)';

  await saveMessage({
    userId,
    sessionId,
    role: 'assistant',
    text: finalText,
    metadata: executedCalls.length ? { tools: executedCalls.map((c) => c.name) } : null,
  });

  onEvent({ type: 'final', content: finalText, toolCalls: executedCalls.length });

  return { finalText, toolCalls: executedCalls };
}

/** 拉当前用户的历史(供前端首次进入渲染) */
async function history(userId) {
  const rows = await chatMessageRepository.listByUser(userId);
  return rows.map((r) => ({
    id: r.id,
    role: r.type,           // 'user' | 'assistant' | 'ai' (legacy)
    text: r.text,
    timestamp: r.timestamp,
    metadata: r.metadata,
  }));
}

async function clearHistory(userId) {
  const affected = await chatMessageRepository.clearByUser(userId);
  return { cleared: affected };
}

module.exports = { runAgent, history, clearHistory };
