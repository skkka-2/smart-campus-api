const { db } = require('../db');

const userRepository = {
  /** 按用户名查找 */
  async findByUsername(username) {
    const [rows] = await db.query(
      'SELECT id, username, password, phone, created_at FROM userlist WHERE username = ? LIMIT 1',
      [username],
    );
    return rows[0] || null;
  },

  /** 按手机号查找 */
  async findByPhone(phone) {
    const [rows] = await db.query(
      'SELECT id, username, phone FROM userlist WHERE phone = ? LIMIT 1',
      [phone],
    );
    return rows[0] || null;
  },

  /** 按 id 查找(不返回密码) */
  async findById(id) {
    const [rows] = await db.query(
      'SELECT id, username, phone, created_at FROM userlist WHERE id = ? LIMIT 1',
      [id],
    );
    return rows[0] || null;
  },

  /** 创建用户,返回 insertId */
  async create({ username, password, phone }) {
    const [res] = await db.query(
      'INSERT INTO userlist (username, password, phone) VALUES (?, ?, ?)',
      [username, password, phone],
    );
    return res.insertId;
  },
};

module.exports = userRepository;
