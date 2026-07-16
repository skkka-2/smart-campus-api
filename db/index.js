require('dotenv').config();

const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'item_01',
  waitForConnections: true,
  connectionLimit: 10,
});

async function testConnection() {
  try {
    const connection = await db.getConnection();
    console.log('[db] Connected to MySQL pool successfully');
    await connection.query('SELECT 1');
    connection.release();
  } catch (err) {
    console.error('[db] Failed to connect to MySQL:', err.message);
  }
}

testConnection();

module.exports = db;
