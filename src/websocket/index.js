const WebSocket = require('ws');
const chatService = require('../services/chatService');
const { verify, extractFromHeader } = require('../utils/jwt');
const { handleChatConnection } = require('../chat/chatSocketHandler');

/** 聊天大厅 receiver_id */
const HALL_ID = '1';

/** userId -> Set<WebSocket> */
const clients = new Map();

/**
 * 岗位浏览房间
 *   jobId(string) -> Set<WebSocket>
 * 用于"N 人正在看这个岗位"实时广播。
 */
const jobRooms = new Map();

// ==================== 聊天大厅 ====================

function broadcastOnlineUsers() {
  const users = Array.from(clients.keys());
  const payload = JSON.stringify({ type: 'onlineUsers', users });
  for (const socketSet of clients.values()) {
    for (const ws of socketSet) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}

function dispatch(senderId, receiverIds, message) {
  const targets = Array.isArray(receiverIds) ? receiverIds : [receiverIds];
  const payload = JSON.stringify(message);
  for (const rid of targets) {
    if (String(rid) === String(senderId)) continue;
    const sockets = clients.get(String(rid));
    if (!sockets) continue;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}

// ==================== 岗位浏览房间 ====================

function broadcastJobViewers(jobId) {
  const room = jobRooms.get(String(jobId));
  const count = room ? room.size : 0;
  const payload = JSON.stringify({ type: 'jobViewers', jobId: String(jobId), count });
  if (!room) return;
  for (const ws of room) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function joinJobRoom(ws, jobId) {
  const key = String(jobId);
  if (!jobRooms.has(key)) jobRooms.set(key, new Set());
  jobRooms.get(key).add(ws);
  ws._joinedJobRooms = ws._joinedJobRooms || new Set();
  ws._joinedJobRooms.add(key);
  broadcastJobViewers(key);
}

function leaveJobRoom(ws, jobId) {
  const key = String(jobId);
  const room = jobRooms.get(key);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) jobRooms.delete(key);
  ws._joinedJobRooms?.delete(key);
  broadcastJobViewers(key);
}

function leaveAllJobRooms(ws) {
  const rooms = ws._joinedJobRooms;
  if (!rooms) return;
  for (const key of rooms) {
    const room = jobRooms.get(key);
    if (room) {
      room.delete(ws);
      if (room.size === 0) jobRooms.delete(key);
      broadcastJobViewers(key);
    }
  }
  ws._joinedJobRooms = null;
}

// ==================== handshake ====================

function parseHandshake(reqUrl) {
  try {
    const url = new URL(reqUrl, 'http://localhost');
    const userId = url.searchParams.get('userId');
    const token =
      url.searchParams.get('token') || extractFromHeader(url.searchParams.get('authorization'));
    return { userId, token };
  } catch {
    return { userId: null, token: null };
  }
}

function validateHandshake({ userId, token }) {
  // 旧 / 通道仍允许匿名岗位浏览，但旧聊天写入不能再靠 query 里的 userId 冒充身份。
  // 新聊天室统一使用 /chat?ticket=...，这里仅保留已验证 token 的兼容连接。
  if (!userId || !token) return null;
  try {
    const payload = verify(token);
    return payload.id == null ? null : String(payload.id);
  } catch {
    return null;
  }
}

// ==================== 主入口 ====================

function initWebSocket(server) {
  // 使用 noServer 明确分流 Upgrade 路径，避免未来新增其它 WS 通道时互相抢连接。
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    // / 是旧岗位浏览房间，/chat 是新聊天协议，其它路径不接受 Upgrade。
    if (pathname !== '/' && pathname !== '/chat') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/chat') {
      handleChatConnection(ws, req);
      return;
    }

    const handshake = parseHandshake(req.url);
    const userId = validateHandshake(handshake);

    // 岗位房间连接不强制登录(匿名用户也能看"N 人在看")
    // 聊天需要登录,消息处理里会检查
    if (userId) {
      if (!clients.has(userId)) clients.set(userId, new Set());
      clients.get(userId).add(ws);
      broadcastOnlineUsers();
    }

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // === 岗位房间 ===
      if (msg.type === 'joinJobRoom' && msg.jobId != null) {
        joinJobRoom(ws, msg.jobId);
        return;
      }
      if (msg.type === 'leaveJobRoom' && msg.jobId != null) {
        leaveJobRoom(ws, msg.jobId);
        return;
      }

      // === 聊天大厅(登录用户) ===
      if (!userId) return;
      const { senderId, receiverIds, content } = msg;
      if (senderId == null || content == null) return;

      const groupChat = Array.isArray(receiverIds);
      const dbReceiver = groupChat ? HALL_ID : String(receiverIds);
      const { createdAt } = await chatService.save({
        senderId: userId,
        receiverId: dbReceiver,
        content,
      });

      const payload = {
        senderId: userId,
        content,
        createdAt: new Date(createdAt.replace(' ', 'T')).toISOString(),
      };
      dispatch(userId, groupChat ? Array.from(clients.keys()) : [receiverIds], payload);
    });

    ws.on('close', () => {
      // 清岗位房间
      leaveAllJobRooms(ws);
      // 清聊天大厅
      if (userId) {
        const set = clients.get(userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) clients.delete(userId);
        }
        broadcastOnlineUsers();
      }
    });

    ws.on('error', (err) => {
      console.error(`[ws] error:`, err.message);
    });
  });

  console.log('[ws] WebSocket ready (with job rooms)');

  return {
    close() {
      for (const ws of wss.clients) {
        ws.close(1001, 'server shutting down');
      }
      return new Promise((resolve) => {
        wss.close(resolve);
      });
    },
  };
}

module.exports = initWebSocket;
