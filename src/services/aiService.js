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

  /**
   * 简历适配度分析
   *   给出岗位描述 + 用户简历,让 AI 输出适配度评估 + 改进建议
   */
  async analyzeResume({ userId, resume, jobTitle, jobDesc, jobRequirements = [] } = {}) {
    if (!userId) throw BizError.badRequest('缺少用户 id');
    if (!resume || resume.trim().length < 20) {
      throw BizError.badRequest('简历内容太短,至少 20 字');
    }
    if (!jobTitle || !jobDesc) throw BizError.badRequest('缺少岗位信息');

    const prompt = [
      `你是一位资深校招 HR 与技术面试官。请对下面这份候选人简历,针对以下岗位做一次简明的适配度分析。`,
      ``,
      `【目标岗位】${jobTitle}`,
      `【岗位描述】${jobDesc.slice(0, 500)}`,
      `【核心要求】`,
      ...(jobRequirements || []).slice(0, 8).map((r, i) => `  ${i + 1}. ${r}`),
      ``,
      `【候选人简历】`,
      resume.slice(0, 2000),
      ``,
      `请严格按以下格式输出(用中文,总字数控制在 400 字以内):`,
      ``,
      `⭐ 综合适配度:{一个 0-100 的分数} / 100`,
      ``,
      `✅ 匹配亮点(3 条以内)`,
      `- ...`,
      `- ...`,
      ``,
      `⚠️ 差距与改进建议(3 条以内)`,
      `- ...`,
      `- ...`,
      ``,
      `📝 简历一句话包装建议:...`,
    ].join('\n');

    const response = await getClient().chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      n: 1,
      max_tokens: 700,
    });

    return {
      analysis: response.choices[0]?.message?.content?.trim() || '(AI 无响应)',
    };
  },
};

module.exports = aiService;
