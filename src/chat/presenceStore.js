const WebSocket = require('ws');

/**
 * Presence 的最小接口实现。
 * 多实例部署时只需要替换这个 store，不让业务服务直接依赖 Map。
 */
class PresenceStore {
  async add() { throw new Error('PresenceStore.add is not implemented'); }
  async remove() { throw new Error('PresenceStore.remove is not implemented'); }
  async has() { throw new Error('PresenceStore.has is not implemented'); }
  async onlineUserIds() { throw new Error('PresenceStore.onlineUserIds is not implemented'); }
  async sendToUsers() { throw new Error('PresenceStore.sendToUsers is not implemented'); }
  async broadcast() { throw new Error('PresenceStore.broadcast is not implemented'); }
}

class InMemoryPresenceStore extends PresenceStore {
  constructor() {
    super();
    this.connections = new Map();
  }

  async add(userId, socket) {
    const key = String(userId);
    if (!this.connections.has(key)) this.connections.set(key, new Set());
    this.connections.get(key).add(socket);
  }

  async remove(userId, socket) {
    const key = String(userId);
    const sockets = this.connections.get(key);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) this.connections.delete(key);
  }

  async has(userId) {
    return this.connections.has(String(userId));
  }

  async onlineUserIds() {
    return Array.from(this.connections.keys());
  }

  async sendToUsers(userIds, event) {
    const payload = JSON.stringify(event);
    const targets = new Set((userIds || []).map((id) => String(id)));
    for (const userId of targets) {
      const sockets = this.connections.get(userId);
      if (!sockets) continue;
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }
    }
  }

  async broadcast(event) {
    await this.sendToUsers(await this.onlineUserIds(), event);
  }
}

const presenceStore = new InMemoryPresenceStore();

module.exports = { PresenceStore, InMemoryPresenceStore, presenceStore };
