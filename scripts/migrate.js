const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const connectionOptions = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: 'utf8mb4',
  timezone: config.db.timezone,
  multipleStatements: true,
};

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [config.db.database, tableName, columnName],
  );
  return rows.length > 0;
}

async function ensureColumn(connection, tableName, columnName, definition) {
  if (await hasColumn(connection, tableName, columnName)) return;
  await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  console.log('[db] added column %s.%s', tableName, columnName);
}

async function hasIndex(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    [config.db.database, tableName, indexName],
  );
  return rows.length > 0;
}

async function ensureIndex(connection, tableName, indexName, definition) {
  if (await hasIndex(connection, tableName, indexName)) return;
  await connection.query(`ALTER TABLE \`${tableName}\` ADD ${definition}`);
  console.log('[db] added index %s.%s', tableName, indexName);
}

async function migrate() {
  const connection = await mysql.createConnection(connectionOptions);
  try {
    const [baseTables] = await connection.query(
      `SELECT TABLE_NAME
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('userlist', 'category', 'article', 'job')`,
      [config.db.database],
    );
    if (baseTables.length < 4) {
      throw new Error('基础业务表不完整，请先执行 mysql -u root -p < schema.sql');
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS refresh_token (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_token_hash (token_hash),
        KEY idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS chatmessages (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id VARCHAR(64) NOT NULL,
        session_id VARCHAR(64) DEFAULT NULL,
        type ENUM('user', 'assistant', 'ai') NOT NULL,
        text TEXT NOT NULL,
        metadata JSON DEFAULT NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_user_time (user_id, timestamp),
        KEY idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS agent_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        seq INT UNSIGNED NOT NULL,
        type VARCHAR(32) NOT NULL,
        payload JSON NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_session_seq (session_id, seq),
        KEY idx_user_session (user_id, session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    for (const [column, definition] of [
      [
        'source_type',
        "VARCHAR(24) NOT NULL DEFAULT 'native' COMMENT 'native/editorial/newsnow/hackernews' AFTER sort_type",
      ],
      ['source_name', 'VARCHAR(64) DEFAULT NULL AFTER source_type'],
      ['source_url', 'VARCHAR(500) DEFAULT NULL AFTER source_name'],
      ['external_id', 'VARCHAR(160) DEFAULT NULL AFTER source_url'],
      ['published_at', 'DATETIME DEFAULT NULL AFTER external_id'],
    ]) {
      await ensureColumn(connection, 'article', column, definition);
    }
    await ensureIndex(
      connection,
      'article',
      'idx_article_published',
      'KEY idx_article_published (published_at)',
    );
    await ensureIndex(
      connection,
      'article',
      'uk_article_source',
      'UNIQUE KEY uk_article_source (source_type, external_id)',
    );

    for (const [column, definition] of [
      ['email', "VARCHAR(128) DEFAULT NULL COMMENT '邮箱' AFTER phone"],
      ['avatar_url', 'VARCHAR(500) DEFAULT NULL'],
      ['bio', 'VARCHAR(200) DEFAULT NULL'],
      ['major', 'VARCHAR(64) DEFAULT NULL'],
      ['college', 'VARCHAR(64) DEFAULT NULL'],
      ['grade', 'VARCHAR(16) DEFAULT NULL'],
      ['interests', 'JSON DEFAULT NULL'],
      ['career_direction', 'VARCHAR(64) DEFAULT NULL'],
      ['preferred_city', 'VARCHAR(32) DEFAULT NULL'],
    ]) {
      await ensureColumn(connection, 'userlist', column, definition);
    }
    await ensureIndex(connection, 'userlist', 'uk_email', 'UNIQUE KEY uk_email (email)');

    await ensureColumn(
      connection,
      'chatmessages',
      'session_id',
      'VARCHAR(64) DEFAULT NULL AFTER user_id',
    );
    await ensureColumn(connection, 'chatmessages', 'metadata', 'JSON DEFAULT NULL AFTER text');
    await ensureIndex(connection, 'chatmessages', 'idx_session', 'KEY idx_session (session_id)');
    await connection.query(
      "ALTER TABLE chatmessages MODIFY COLUMN type ENUM('user', 'assistant', 'ai') NOT NULL",
    );

    const chatSchemaPath = path.join(__dirname, '..', 'docs', 'chat-data-model.sql');
    await connection.query(fs.readFileSync(chatSchemaPath, 'utf8'));
    console.log('[db] additive migration complete');
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error('[db] migration failed:', error.message);
  process.exitCode = 1;
});
