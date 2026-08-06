const mysql = require('mysql2/promise');
const config = require('../config');

const db = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: false,
  timezone: config.db.timezone,
});

async function verifyConnection() {
  try {
    const conn = await db.getConnection();
    await conn.query('SELECT 1');
    conn.release();
    console.log('[db] connected: %s@%s:%s/%s', config.db.user, config.db.host, config.db.port, config.db.database);
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    throw err;
  }
}

module.exports = { db, verifyConnection };
