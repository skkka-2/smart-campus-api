const { db } = require('../db');

const PROFILE_FIELDS = [
  'id', 'username', 'phone', 'avatar_url', 'bio',
  'major', 'college', 'grade', 'interests',
  'career_direction', 'preferred_city', 'created_at',
];

const userRepository = {
  async findByUsername(username) {
    const [rows] = await db.query(
      'SELECT id, username, password, phone, created_at FROM userlist WHERE username = ? LIMIT 1',
      [username],
    );
    return rows[0] || null;
  },

  async findByPhone(phone) {
    const [rows] = await db.query(
      'SELECT id, username, phone FROM userlist WHERE phone = ? LIMIT 1',
      [phone],
    );
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await db.query(
      'SELECT id, username, phone, created_at FROM userlist WHERE id = ? LIMIT 1',
      [id],
    );
    return rows[0] || null;
  },

  /** 取 password hash（改密验证旧密码用，不对外暴露） */
  async findPasswordById(id) {
    const [rows] = await db.query(
      'SELECT id, password FROM userlist WHERE id = ? LIMIT 1',
      [id],
    );
    return rows[0] || null;
  },

  async updatePassword(id, hashedPassword) {
    await db.query('UPDATE userlist SET password = ? WHERE id = ?', [hashedPassword, id]);
  },

  /** 完整画像 */
  async findProfileById(id) {
    const [rows] = await db.query(
      `SELECT ${PROFILE_FIELDS.join(', ')} FROM userlist WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!rows[0]) return null;
    const row = rows[0];
    // interests 是 JSON,mysql2 已经反序列化,但可能是 null
    if (row.interests == null) row.interests = [];
    return row;
  },

  async create({ username, password, phone }) {
    const [res] = await db.query(
      'INSERT INTO userlist (username, password, phone) VALUES (?, ?, ?)',
      [username, password, phone],
    );
    return res.insertId;
  },

  /**
   * 更新画像字段(只更新传入的字段,支持 null 清空)
   * @param {number} id
   * @param {object} patch
   */
  async updateProfile(id, patch) {
    const allow = ['avatar_url', 'bio', 'major', 'college', 'grade', 'career_direction', 'preferred_city'];
    const sets = [];
    const params = [];
    for (const key of allow) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`\`${key}\` = ?`);
        params.push(patch[key] || null);
      }
    }
    // interests 是数组 → JSON.stringify
    if (Object.prototype.hasOwnProperty.call(patch, 'interests')) {
      sets.push('`interests` = ?');
      params.push(JSON.stringify(patch.interests || []));
    }
    if (!sets.length) return;
    params.push(id);
    await db.query(`UPDATE userlist SET ${sets.join(', ')} WHERE id = ?`, params);
  },
};

module.exports = userRepository;
