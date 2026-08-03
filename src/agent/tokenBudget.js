// Token 估算：单一事实来源（学自 grok-build 的 xai-token-estimation crate）。
// 展示用量、压缩触发判断都用这里的函数，保证一致性 > 精确性。
//
// 混合策略（学自 pi compaction.ts:202 estimateContextTokens）：
//   以最后一次 API 真实 usage（prompt_tokens）为基准 + 之后新增消息的估算。
//   零成本，比纯估算准得多。
//
// 中文特殊处理：pi/grok-build 用 chars/4，但中文一个字约 1 token、3 字节，
//   bytes/4 会低估。这里用「中文字符 1:1 + 其他 4 字符 1 token」。

// CJK 统一表意文字 + 全角标点/符号。
// 用 \u 转义区间，避免正则里出现字面全角空格触发 eslint no-irregular-whitespace。
const CJK_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g;

/** 粗估一段文本的 token 数（中文 1:1，其他 4 字符 1 token） */
function estimateText(text) {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) || []).length;
  const rest = text.length - cjk;
  return cjk + Math.ceil(rest / 4);
}

/** 粗估一条 OpenAI message 的 token 数（含 role/结构开销） */
function estimateMessage(msg) {
  let n = 4; // role/结构开销
  if (typeof msg.content === 'string') n += estimateText(msg.content);
  if (Array.isArray(msg.tool_calls)) {
    for (const c of msg.tool_calls) {
      n += estimateText(c.function?.name) + estimateText(c.function?.arguments);
    }
  }
  if (msg.role === 'tool' && typeof msg.content === 'string') n += estimateText(msg.content);
  return n;
}

/**
 * 混合估算：以最后一次 API 真实 usage 为基准 + 之后新增消息的估算。
 * @param {Array} messages 当前 messages 数组
 * @param {object|null} lastUsage 最后一次 completion 的 usage（含 prompt_tokens）
 * @param {number|null} lastUsageIndex lastUsage 对应的 messages 下标
 * @returns {number} 估算的上下文 token 数
 *
 * 注意：prompt_tokens 是「这次请求全部输入」的 token 数，已含 system + history + 当前 message，
 *       所以用它做基准时不要再加 system prompt，否则重复计数。
 *       trailing 只是「最后一次请求之后新增的」，不含基准。
 */
function estimateContextTokens(messages, lastUsage, lastUsageIndex) {
  if (!lastUsage || lastUsageIndex == null || lastUsage.prompt_tokens == null) {
    // provider 不支持 stream_options 或首轮：退回纯估算
    return messages.reduce((sum, m) => sum + estimateMessage(m), 0);
  }
  let trailing = 0;
  for (let i = lastUsageIndex + 1; i < messages.length; i += 1) {
    trailing += estimateMessage(messages[i]);
  }
  return lastUsage.prompt_tokens + trailing;
}

module.exports = { estimateText, estimateMessage, estimateContextTokens };
