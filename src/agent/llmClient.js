const OpenAI = require('openai');
const { observeOpenAI } = require('@langfuse/openai');
const config = require('../config');
const { BizError } = require('../utils/response');

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    if (!config.openai.apiKey) throw BizError.badRequest('OpenAI API key 未配置');
    cachedClient = observeOpenAI(new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    }));
  }
  return cachedClient;
}

module.exports = { getClient };
