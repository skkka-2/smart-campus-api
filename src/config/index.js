require('dotenv').config();

const parseInt10 = (v, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
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
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

module.exports = config;
