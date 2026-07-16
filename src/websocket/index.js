const WebSocket = require('ws');
const chatService = require('../services/chatService');
const { verify, extractFromHeader } = require('../utils/jwt');

/**
 * 大厅 receiver_id(所有群聊消息都记这个)
 * TODO Phase 3:用真正的房间号
 */
const HALL_ID = '1';

/**
 * 在线用户注册表:userId -> Set<WebSocket>
 * 用 Set 是为了支持同一用户多标签页/多端在线
 */
const clients = new Map();

/** 广播在线用户列表 */
function broadcastOnlineUsers() {
  const users = Array.from(clients.keys());
  const payload = JSON.stringify({ type: 'onlineUsers', users });
  for (const socketSet of clients.values()) {
    for (const ws of socketSet) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}

/** 定点发消息给指定 receiverIds(不发给自己) */
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

/**
 * 从连接 URL 里解析 userId 和(可选)token
 * 期望 URL 形如 /?userId=xxx&token=yyy
 */
function parseHandshake(reqUrl) {
  try {
    const url = new URL(reqUrl, 'http://localhost');
    const userId = url.searchParams.get('userId');
    const token = url.searchParams.get('token') || extractFromHeader(url.searchParams.get('authorization'));
    return { userId, token };
  } catch {
    return { userId: null, token: null };
  }
}

/** 验证握手参数;返回真实 userId(或 null 表示拒绝) */
function validateHandshake({ userId, token }) {
  if (!userId) return null;
  if (!token) return userId; // TODO Phase 3:强制要 token
  try {
    const payload = verify(token);
    // 允许查询参数里的 userId 和 token 里的对齐;不对齐时以 token 为准
    return String(payload.id || userId);
  } catch {
    return null;
  }
}

function initWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    // ⚠️ userId 是 connection scope,不再是模块级——修了新连接覆盖旧的 bug
    const handshake = parseHandshake(req.url);
    const userId = validateHandshake(handshake);
    if (!userId) {
      ws.close(4001, 'unauthorized');
      return;
    }

    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);
    broadcastOnlineUsers();

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // 忽略非 JSON
      }
      const { senderId, receiverIds, content } = msg;
      const senderIsSelf = String(senderId) === userId;
      const safeSenderId = senderIsSelf ? userId : userId; // 无论前端给什么,发送方一律以连接身份为准

      const groupChat = Array.isArray(receiverIds);
      const dbReceiver = groupChat ? HALL_ID : String(receiverIds);
      const { createdAt } = await chatService.save({
        senderId: safeSenderId,
        receiverId: dbReceiver,
        content,
      });

      const payload = {
        senderId: safeSenderId,
        content,
        createdAt: new Date(createdAt.replace(' ', 'T')).toISOString(),
      };
      dispatch(safeSenderId, groupChat ? Array.from(clients.keys()) : [receiverIds], payload);
    });

    ws.on('close', () => {
      const set = clients.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) clients.delete(userId);
      }
      broadcastOnlineUsers();
    });

    ws.on('error', (err) => {
      console.error(`[ws] user=${userId} error:`, err.message);
    });
  });

  console.log('[ws] WebSocket ready');
}

module.exports = initWebSocket;
