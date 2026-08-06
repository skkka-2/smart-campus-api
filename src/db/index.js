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

const REQUIRED_SCHEMA = {
  userlist: [
    'id',
    'username',
    'password',
    'phone',
    'email',
    'avatar_url',
    'bio',
    'major',
    'college',
    'grade',
    'interests',
    'career_direction',
    'preferred_city',
    'created_at',
  ],
  refresh_token: ['id', 'user_id', 'token_hash', 'expires_at', 'revoked', 'created_at'],
  category: ['id', 'name', 'slug', 'icon', 'sort_order', 'created_at'],
  article: [
    'id',
    'title',
    'content',
    'excerpt',
    'cover_url',
    'category_id',
    'author_id',
    'author_name',
    'view_count',
    'like_count',
    'sort_type',
    'created_at',
    'updated_at',
  ],
  article_like: ['id', 'article_id', 'user_id', 'created_at'],
  comment: ['id', 'article_id', 'user_id', 'userName', 'content', 'like', 'time', 'created_at'],
  layoutlist: ['id', 'bang1', 'bang2', 'bang3'],
  message: ['id', 'sender_id', 'receiver_id', 'content', 'created_at'],
  chatmessages: ['id', 'user_id', 'session_id', 'type', 'text', 'metadata', 'timestamp'],
  job: [
    'id',
    'title',
    'company',
    'city',
    'work_type',
    'category',
    'degree_required',
    'description',
    'created_at',
  ],
  job_favorite: ['id', 'job_id', 'user_id', 'created_at'],
  job_application: ['id', 'job_id', 'user_id', 'message', 'status', 'created_at'],
  agent_events: ['id', 'session_id', 'user_id', 'seq', 'type', 'payload', 'created_at'],
  chat_conversations: ['id', 'type', 'status', 'last_message_id', 'created_at', 'updated_at'],
  chat_conversation_members: ['conversation_id', 'user_id', 'role', 'status', 'joined_at'],
  chat_messages: [
    'id',
    'conversation_id',
    'sender_id',
    'client_message_id',
    'type',
    'content',
    'created_at',
  ],
  chat_friendships: [
    'id',
    'requester_id',
    'addressee_id',
    'pair_low',
    'pair_high',
    'status',
    'created_at',
    'updated_at',
  ],
  chat_group_invites: [
    'id',
    'conversation_id',
    'inviter_id',
    'invitee_id',
    'status',
    'created_at',
    'updated_at',
  ],
  chat_socket_tickets: ['id', 'user_id', 'token_hash', 'expires_at', 'used_at', 'created_at'],
  chat_legacy_messages: [
    'legacy_message_id',
    'sender_id',
    'receiver_id',
    'content',
    'created_at',
    'migration_status',
  ],
};

async function verifyConnection() {
  try {
    const conn = await db.getConnection();
    await conn.query('SELECT 1');
    conn.release();
    console.log(
      '[db] connected: %s@%s:%s/%s',
      config.db.user,
      config.db.host,
      config.db.port,
      config.db.database,
    );
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    throw err;
  }
}

async function verifySchema() {
  const tableNames = Object.keys(REQUIRED_SCHEMA);
  const [tables] = await db.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME IN (?)`,
    [config.db.database, tableNames],
  );
  const existingTables = new Set(tables.map((row) => row.TABLE_NAME));
  const missingTables = tableNames.filter((table) => !existingTables.has(table));

  const [columns] = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN (?)`,
    [config.db.database, tableNames],
  );
  const existingColumns = new Set(columns.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const missingColumns = [];
  for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
    for (const column of requiredColumns) {
      if (!existingColumns.has(`${table}.${column}`)) missingColumns.push(`${table}.${column}`);
    }
  }

  if (missingTables.length || missingColumns.length) {
    const details = [
      missingTables.length ? `tables: ${missingTables.join(', ')}` : '',
      missingColumns.length ? `columns: ${missingColumns.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(
      `[db] schema incomplete (${details}). Run npm run db:migrate for an existing database.`,
    );
  }

  console.log('[db] schema verified: %d tables', tableNames.length);
}

module.exports = { db, verifyConnection, verifySchema };
