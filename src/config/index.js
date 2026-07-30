require('dotenv').config();

const parseInt10 = (v, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
};

const parseFloatNum = (v, dflt) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

const parseBool = (v, dflt = false) => {
  if (v == null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const detectModelProvider = (baseUrl = '') => {
  if (baseUrl.includes('open.bigmodel.cn')) return 'zhipu_glm';
  if (baseUrl.includes('tokenhub')) return 'tencent_tokenhub';
  if (baseUrl.includes('chatanywhere')) return 'chatanywhere';
  if (baseUrl.includes('api.openai.com')) return 'openai';
  return 'openai_compatible';
};

const config = {
  port: parseInt10(process.env.PORT, 3007),

  db: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt10(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'item_01',
    connectionLimit: parseInt10(process.env.MYSQL_POOL_SIZE, 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-do-not-use-in-prod',
    expiresIn: process.env.JWT_EXPIRES_IN || '10h',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.chatanywhere.tech/v1',
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    maxTokens: parseInt10(process.env.OPENAI_MAX_TOKENS, 512),
    provider: detectModelProvider(process.env.OPENAI_BASE_URL || 'https://api.chatanywhere.tech/v1'),
  },

  agent: {
    intentExtractionEnabled: parseBool(process.env.AGENT_INTENT_EXTRACTION_ENABLED, true),
  },

  observability: {
    enabled: parseBool(process.env.AGENT_OBSERVABILITY_ENABLED, false),
    region: process.env.CLS_DEFAULT_REGION || 'ap-guangzhou',
    topicId: process.env.CLS_TOPIC_ID || '',
    secretId: process.env.TENCENTCLOUD_SECRET_ID || '',
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY || '',
    serviceName: process.env.SERVICE_NAME || 'smart-campus-agent',
    sampleRatio: Math.min(Math.max(parseFloatNum(process.env.AGENT_TRACE_SAMPLE_RATIO, 1), 0), 1),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

module.exports = config;
