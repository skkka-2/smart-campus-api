// 上下文管理：压缩的第一步——截断旧 tool result。
// 学自 openclaw 的四态路由（preemptive-compaction.ts:371）：
//   先试"截断 tool result"（免费、近乎无损），不够才"摘要"（花 LLM、有损）。
//
// 你的 tool result 是最大的上下文消耗源（list_jobs 一次 20 个岗位），
// 而且旧的岗位列表模型早就不需要了——它已基于结果做了决策。
// 截断旧 tool result 比直接摘要省钱得多、丢的信息更少。

// 旧 tool result 替换成这个提示，让模型知道"这里原本有数据，被省略了"，
// 而不是以为工具返回了空。
const TRUNCATED_HINT = (toolCallId) =>
  JSON.stringify({ _truncated: true, message: '此工具结果已因上下文长度被省略，如需详情请重新调用工具。', tool_call_id: toolCallId });

/**
 * 截断旧 tool result：保留最近 keepRounds 轮的全文，更旧的 tool result 内容替换成提示。
 *
 * "一轮"= 一个 assistant 消息（含其 tool_calls）+ 紧随的 tool results。
 * 只改 tool result 的 content，不动 assistant 消息（保 tool_call 结构完整，避免 API 报错）。
 *
 * @param {Array} messages OpenAI messages 数组（会被原地修改并返回）
 * @param {object} opts
 * @param {number} opts.keepRounds 保留最近几轮的 tool result 全文，默认 2
 * @returns {Array} 修改后的 messages（同引用）
 */
function truncateOldToolResults(messages, { keepRounds = 2 } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  // 从后往前数 assistant 消息（含 tool_calls 的才算"一轮"），定位截断边界。
  // 边界之前的 tool result 被截断。
  let assistantWithToolsSeen = 0;
  let cutoffIndex = messages.length; // 边界之后保留，之前截断
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      assistantWithToolsSeen += 1;
      // 第 keepRounds 个 assistant 就触发：它的 tool result 保留，更早的截断
      if (assistantWithToolsSeen >= keepRounds) {
        cutoffIndex = i;
        break;
      }
    }
  }

  // 没有足够旧的轮次，不截断
  if (cutoffIndex >= messages.length) return messages;

  for (let i = 0; i < cutoffIndex; i += 1) {
    const m = messages[i];
    if (m.role === 'tool' && typeof m.content === 'string' && !m.content.includes('"_truncated"')) {
      m.content = TRUNCATED_HINT(m.tool_call_id);
    }
  }
  return messages;
}

// ===== 摘要压缩（P2-2c）=====
// 学自 grok-build 的 full-replace + assemble 顺序：
//   [system, context, last_user_query, recent(最近N轮原文), 摘要(最末)]
// 摘要放最末：利用 recency bias，模型最关注末尾，而摘要是"你之前做了什么"的最重要输入。
//
// 硬约束（学自 pi compaction.ts:346）：永远不在 tool_result 处切。
//   tool_result 必须紧跟其 tool_call，切断了 OpenAI API 直接报 400。

/**
 * 找摘要的切点：从后往前累积 token，够 keepRecentTokens 时停在一个"合法切点"。
 * 合法切点 = user 消息 或 不带 tool_calls 的 assistant 消息。
 * 绝不在 tool_result 处切（它必须跟 tool_call 配对）。
 *
 * @returns { cutoffIndex, recentMessages } cutoffIndex 之前的历史要被摘要替代
 */
function findCompactionCutPoint(messages, keepRecentTokens, estimateTextFn) {
  let accumulated = 0;
  let cutIndex = 0;
  // 从后往前，累积到 keepRecentTokens 时，从该位置往前找最近的合法切点。
  // 注意：若超阈值的位置是 tool_result，它属于前面的 tool_call，切点必须在它们之前——
  // 往后找会落到 tool_result 之后（破坏配对）或找不到（tool_result 是末尾）。
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const tokens = estimateMsgTokens(m, estimateTextFn);
    accumulated += tokens;
    if (accumulated >= keepRecentTokens) {
      // 从 i 往前找最近的合法切点（user 或 无 tool_calls 的 assistant）
      for (let j = i; j >= 0; j -= 1) {
        if (isValidCutPoint(messages[j])) {
          cutIndex = j;
          return { cutIndex };
        }
      }
      break;
    }
  }
  return { cutIndex };
}

function estimateMsgTokens(msg, estimateTextFn) {
  if (!msg) return 0;
  let n = 4;
  if (typeof msg.content === 'string') n += estimateTextFn(msg.content);
  if (Array.isArray(msg.tool_calls)) {
    for (const c of msg.tool_calls) {
      n += estimateTextFn(c.function?.name || '') + estimateTextFn(c.function?.arguments || '');
    }
  }
  return n;
}

function isValidCutPoint(msg) {
  if (!msg) return false;
  if (msg.role === 'user') return true;
  // assistant 带 tool_calls 的不能切（后面跟着 tool_result）
  if (msg.role === 'assistant' && (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0)) return true;
  return false;
}

/**
 * 构造摘要 prompt（学自 grok-build full_replace_summary_prompt + pi SUMMARIZATION_PROMPT）。
 * 关键：要求保留标识符原文（岗位 ID、公司名），否则模型会概括成"某个岗位"导致后续没法接。
 * 递归压缩：已有摘要时 treat as authoritative。
 */
function buildSummaryPrompt(oldMessages) {
  const conversation = oldMessages
    .map((m) => {
      if (m.role === 'system') return `[system] ${m.content}`;
      if (m.role === 'user') return `[user] ${m.content}`;
      if (m.role === 'assistant') {
        const text = m.content || '';
        const calls = (m.tool_calls || []).map((c) => `[调用工具 ${c.function.name}(${c.function.arguments})]`).join(' ');
        return `[assistant] ${text} ${calls}`.trim();
      }
      if (m.role === 'tool') return `[tool_result] ${m.content}`;
      return '';
    })
    .join('\n');

  return `你的任务是忠实、简洁地总结以下对话，让接手的助手能无缝继续工作。

【严格保留以下标识符原文】岗位 ID、公司名称、岗位名称、投递记录 ID、用户画像字段值。
不要把「岗位 12345 字节跳动前端实习」概括成「某个前端岗位」。

【如果以下对话中已包含一份之前的摘要】（以「本次会话是接续之前的对话」开头），
把它当作早期历史的权威记录，将其中仍然相关的信息继承到你的新摘要里，
避免信息在多次压缩中逐层衰减。

按以下固定结构输出，每个标题都要出现（无内容写「无」）：

## 用户目标
## 已确认的偏好与约束
## 已完成
## 进行中
## 关键决策
## 下一步
（若有下一步，请附一段最近对话的原文引用，标明你正在做什么、停在哪里，避免任务目标漂移）
## 关键上下文

<conversation>
${conversation}
</conversation>`;
}

/**
 * 重组压缩后的历史（学自 grok-build assemble.rs:62 的顺序）。
 *   [system, context, last_user_query, recentMessages, 摘要(最末)]
 * 注意：不传 last_user_query 的单独包装，因为 runner 的 messages 已含当前 user message。
 */
function assembleCompactedHistory({ systemMessages, recentMessages, summary }) {
  const out = [];
  // system + context（页面上下文）类消息原样保留在前
  for (const m of systemMessages) out.push(m);
  // 最近的原文消息（含配对的 tool_call + tool_result）
  for (const m of recentMessages) out.push(m);
  // 摘要放最末，作为 user 消息注入（recency bias）
  out.push({ role: 'user', content: `本次会话是接续之前的对话，以下是之前的摘要：\n\n${summary}` });
  return out;
}

module.exports = {
  truncateOldToolResults,
  TRUNCATED_HINT,
  findCompactionCutPoint,
  buildSummaryPrompt,
  assembleCompactedHistory,
};
