const OpenAI = require('openai');
const chatMessageRepository = require('../repositories/chatMessageRepository');
const { BizError } = require('../utils/response');
const config = require('../config');

let cachedClient = null;
function getClient() {
  if (!cachedClient) {
    if (!config.openai.apiKey) {
      throw BizError.badRequest('OpenAI API key 未配置');
    }
    cachedClient = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    });
  }
  return cachedClient;
}

const aiService = {
  /** 发消息给 AI,存两条对话记录(user + ai) */
  async chat({ userId, content } = {}) {
    if (!userId) throw BizError.badRequest('缺少用户 id');
    if (!content || !content.trim()) throw BizError.badRequest('消息不能为空');

    await chatMessageRepository.create({ userId, type: 'user', text: content });

    const response = await getClient().chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content }],
      n: 1,
      max_tokens: config.openai.maxTokens,
    });

    const aiText = response.choices[0]?.message?.content?.trim() || '(AI 无响应)';
    await chatMessageRepository.create({ userId, type: 'ai', text: aiText });

    return { reply: aiText };
  },

  /** 拉某用户的历史对话 */
  async history(userId) {
    if (!userId) throw BizError.badRequest('缺少用户 id');
    return chatMessageRepository.listByUser(userId);
  },

  /** 清空某用户的对话 */
  async clearHistory(userId) {
    if (!userId) throw BizError.badRequest('缺少用户 id');
    const affected = await chatMessageRepository.clearByUser(userId);
    return { cleared: affected };
  },
};

module.exports = aiService;
