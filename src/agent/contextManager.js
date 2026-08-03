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

module.exports = { truncateOldToolResults, TRUNCATED_HINT };
