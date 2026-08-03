// 密钥精确值脱敏：不猜哪里是密钥，而是记住密钥长什么样，在所有日志里全文替换。
// 学自 openclaw 的 secret-redaction-registry.ts：
//   字段名脱敏管不到"密钥出现在自由文本里"的情况（如 SDK error message 带完整 request URL）。
//   你只有一个 OPENAI_API_KEY，所以不需要 LRU/首字符 probe，用 Set 即可。
//
// 登记三种表面形态（openclaw 的做法）：原始值 / URL 编码 / JSON 转义，
// 因为同一个 key 在 URL query / JSON payload / 纯文本里长得不一样。

const secrets = new Set();

/**
 * 登记一个需要在日志中脱敏的确切值（含 URL 编码形态）。
 * 太短的不登记（避免误伤普通短串）。
 */
function registerSecret(value) {
  if (!value || typeof value !== 'string' || value.length < 8) return;
  secrets.add(value);
  const encoded = encodeURIComponent(value);
  if (encoded !== value) secrets.add(encoded);
}

/**
 * 把已登记的密钥值替换成掩码（保留首尾便于排障对照是哪个 key）。
 * 学自 openclaw 的 keepStart:6 / keepEnd:4。
 */
function redactSecrets(text) {
  if (typeof text !== 'string' || secrets.size === 0) return text;
  let out = text;
  for (const s of secrets) {
    if (out.includes(s)) {
      const masked = s.length > 12 ? `${s.slice(0, 6)}***${s.slice(-4)}` : '***';
      // split/join 比 replace 快且不触发正则转义问题
      out = out.split(s).join(masked);
    }
  }
  return out;
}

/** 清空注册表（仅测试用） */
function _resetForTest() {
  secrets.clear();
}

module.exports = { registerSecret, redactSecrets, _resetForTest };
