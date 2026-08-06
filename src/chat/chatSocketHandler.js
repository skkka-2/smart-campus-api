const crypto = require('node:crypto');
const { URL } = require('node:url');
const WebSocket = require('ws');
const config = require('../config');
const chatService = require('../services/chatService');
const { chatError } = require('./errors');
const { presenceStore } = require('./presenceStore');

function event(type, data, requestId) {
  return {
    eventId: `evt_${crypto.randomUUID()}`,
    type,
    serverTime: new Date().toISOString(),
    ...(requestId ? { requestId } : {}),
    ...(data === undefined ? {} : { data }),
  };
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function sendError(socket, error, requestId, type = 'message.failed') {
  const code =
    error?.chatCode || (typeof error?.code === 'string' ? error.code : 'CHAT_SERVER_ERROR');
  const message = error?.chatCode ? error.message : '聊天服务暂时不可用';
  send(socket, {
    ...event(type, undefined, requestId),
    error: {
      code,
      message,
      retryable: !error?.chatCode,
    },
  });
}

function sendProtocolError(socket, message, requestId) {
  sendError(socket, chatError('CHAT_PROTOCOL_INVALID', message), requestId, 'server.error');
}

function originAllowed(origin) {
  if (!origin) return true;
  return config.cors.origins.includes(origin);
}

function presenceEvent(userId, online, onlineUserIds) {
  return event('presence.updated', { userId: String(userId), online, onlineUserIds });
}

async function broadcastPresence(userId, online) {
  await presenceStore.broadcast(presenceEvent(userId, online, await presenceStore.onlineUserIds()));
}

async function broadcastMessage(userId, message) {
  const audience = await chatService.audienceUserIds(userId, message.conversationId);
  const recipients = audience || (await presenceStore.onlineUserIds());
  await presenceStore.sendToUsers(recipients, event('message.new', { message }));
}

async function handleCommand(socket, userId, command) {
  const requestId = typeof command.requestId === 'string' ? command.requestId : undefined;
  const payload = command.payload || {};

  if (command.type === 'connection.ping') {
    send(socket, event('connection.pong', undefined, requestId));
    return;
  }

  if (command.type === 'message.send' || command.type === 'message.retry') {
    const result = await chatService.sendMessage({
      userId,
      conversationId: payload.conversationId,
      clientMessageId: payload.clientMessageId,
      type: payload.messageType || payload.type || 'text',
      content: payload.content,
      replyToId: payload.replyToId,
    });
    send(socket, event('message.accepted', result, requestId));
    broadcastMessage(userId, result.message).catch((error) =>
      console.error('[chat-ws] message broadcast failed:', error.message),
    );
    return;
  }

  if (command.type === 'message.read') {
    const result = await chatService.markRead(userId, payload.conversationId, payload.messageId);
    send(socket, event('message.read', result, requestId));
    return;
  }

  sendProtocolError(socket, '不支持的聊天指令', requestId);
}

/**
 * 处理 /chat Upgrade 后的连接。岗位浏览房间仍由旧 websocket 模块处理。
 */
function handleChatConnection(socket, req) {
  let userId = null;
  let authenticated = false;
  let closed = false;
  let heartbeatTimer = null;
  let windowStartedAt = Date.now();
  let messagesInWindow = 0;

  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => {
    if (!authenticated) return;
    const now = Date.now();
    if (now - windowStartedAt >= 1000) {
      windowStartedAt = now;
      messagesInWindow = 0;
    }
    messagesInWindow += 1;
    if (messagesInWindow > 30) {
      sendError(socket, chatError('CHAT_RATE_LIMITED', '消息发送过于频繁'), undefined);
      return;
    }
    let command;
    try {
      command = JSON.parse(raw.toString());
    } catch {
      sendProtocolError(socket, '消息格式必须是 JSON');
      return;
    }

    if (!command || typeof command.type !== 'string') {
      sendProtocolError(socket, '缺少指令类型', command?.requestId);
      return;
    }
    handleCommand(socket, userId, command).catch((error) => {
      sendError(socket, error, command.requestId);
    });
  });

  socket.on('close', () => {
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (!authenticated) return;
    presenceStore
      .remove(userId, socket)
      .then(async () => broadcastPresence(userId, await presenceStore.has(userId)))
      .catch((error) => console.error('[chat-ws] presence cleanup failed:', error.message));
  });

  socket.on('error', (error) => {
    console.error('[chat-ws] error:', error.message);
  });

  (async () => {
    try {
      if (!originAllowed(req.headers.origin)) {
        throw chatError('CHAT_SOCKET_TICKET_INVALID', 'WebSocket 来源不受信任', 403);
      }
      const requestUrl = new URL(req.url, 'http://localhost');
      userId = await chatService.consumeSocketTicket(requestUrl.searchParams.get('ticket'));
      if (closed) return;

      await presenceStore.add(userId, socket);
      authenticated = true;
      send(
        socket,
        event('connection.ready', {
          userId,
          heartbeatIntervalMs: 25000,
          protocolVersion: 1,
        }),
      );
      await broadcastPresence(userId, true);

      heartbeatTimer = setInterval(() => {
        if (socket.isAlive === false) {
          socket.terminate();
          return;
        }
        socket.isAlive = false;
        socket.ping();
      }, 25000);
      heartbeatTimer.unref?.();
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1008, 'chat authentication failed');
      }
    }
  })();
}

module.exports = { handleChatConnection };
