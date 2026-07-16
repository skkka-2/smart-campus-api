const messageRepository = require('../repositories/messageRepository');

const chatService = {
  /** 拉最新聊天记录 */
  async history(limit = 10) {
    return messageRepository.latest(limit);
  },

  /** 保存一条消息(供 WebSocket 调用) */
  async save({ senderId, receiverId, content } = {}) {
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const id = await messageRepository.create({ senderId, receiverId, content, createdAt });
    return { id, createdAt };
  },
};

module.exports = chatService;
