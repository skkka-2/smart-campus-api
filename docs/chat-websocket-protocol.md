# Chat WebSocket Protocol

## 1. Connection lifecycle

### 1.1 Acquire ticket

The browser first calls:

```text
POST /api/chat/socket-ticket
Authorization: <access token>
```

The response contains a raw ticket valid for 60 seconds. The server stores only its SHA-256 hash.

### 1.2 Connect

Native browser WebSocket clients cannot reliably set an `Authorization` header, so the short-lived one-time ticket is used in the URL:

```text
wss://example.com/chat?ticket=<ticket>
```

The server atomically verifies and consumes the ticket. It rejects:

- missing ticket;
- unknown ticket;
- expired ticket;
- already consumed ticket.

Invalid authentication closes the socket with code `1008` and does not create an anonymous chat connection.

### 1.3 Ready event

```json
{
  "eventId": "evt_ready_1",
  "type": "connection.ready",
  "serverTime": "2026-08-06T12:30:00.000Z",
  "data": {
    "userId": 7,
    "heartbeatIntervalMs": 25000,
    "protocolVersion": 1
  }
}
```

### 1.4 Reconnect

On every reconnect the client requests a new ticket. It does not retry the old URL. After `connection.ready`, the client reloads conversations and the active conversation's messages over REST, then resumes live events.

## 2. Frame format

### 2.1 Client command

```json
{
  "requestId": "req_01H",
  "type": "message.send",
  "payload": {
    "conversationId": 12,
    "clientMessageId": "msg_01H",
    "messageType": "text",
    "content": { "text": "你好" }
  }
}
```

Required properties:

- `requestId`: unique per client connection; used to correlate acknowledgement.
- `type`: a registered command name.
- `payload`: command-specific object.

The server ignores a client `senderId`. The authenticated connection context is the only source of identity.

### 2.2 Server event

```json
{
  "eventId": "evt_01H",
  "type": "message.new",
  "serverTime": "2026-08-06T12:30:00.000Z",
  "requestId": "req_01H",
  "data": {
    "message": {}
  }
}
```

`requestId` is included when an event is the result of a client command. Broadcast events may omit it.

## 3. Commands

### `message.send`

```json
{
  "requestId": "req_01H",
  "type": "message.send",
  "payload": {
    "conversationId": 12,
    "clientMessageId": "msg_01H",
    "messageType": "text",
    "content": { "text": "你好" },
    "replyToId": null
  }
}
```

Server flow:

```text
parse -> validate -> authenticate -> authorize conversation
      -> validate content/rate limit
      -> insert idempotently
      -> update conversation preview
      -> send message.accepted to sender
      -> broadcast message.new to eligible connections
```

### `message.retry`

The client resends the same `clientMessageId`. The server returns the existing accepted message instead of inserting a duplicate.

### `message.read`

```json
{
  "requestId": "req_read_1",
  "type": "message.read",
  "payload": {
    "conversationId": 12,
    "messageId": 901
  }
}
```

### `connection.ping`

The client sends a ping before the server timeout. The server replies with `connection.pong` or closes an inactive connection.

## 4. Events

```text
connection.ready
connection.pong
message.accepted
message.new
message.failed
message.read
message.recalled
conversation.updated
conversation.member_added
conversation.member_removed
friend.requested
friend.updated
presence.updated
server.error
```

### `message.accepted`

```json
{
  "eventId": "evt_accept_1",
  "type": "message.accepted",
  "requestId": "req_01H",
  "serverTime": "2026-08-06T12:30:00.000Z",
  "data": {
    "message": {
      "id": 901,
      "conversationId": 12,
      "clientMessageId": "msg_01H",
      "senderId": 7,
      "type": "text",
      "content": { "text": "你好" },
      "createdAt": "2026-08-06T12:30:00.000Z"
    },
    "duplicate": false
  }
}
```

If the same command is retried, `duplicate` is `true` and the same stored message is returned.

### `message.failed`

```json
{
  "eventId": "evt_fail_1",
  "type": "message.failed",
  "requestId": "req_01H",
  "serverTime": "2026-08-06T12:30:00.000Z",
  "error": {
    "code": "CHAT_CONVERSATION_FORBIDDEN",
    "message": "无权访问该会话",
    "retryable": false
  }
}
```

## 5. Ordering and deduplication

- `message.id` is the durable ordering key within a conversation.
- Clients render messages by `id`, not by WebSocket arrival time.
- Clients deduplicate by `message.id` and `eventId`.
- A reconnect always reloads the active conversation from REST before accepting live updates.
- The server persists a message before emitting `message.accepted` or `message.new`.
- `clientMessageId` is unique for one sender and conversation.

## 6. Protocol fixtures

Phase 0 must include the following fixtures and run them in both Node and Web test environments:

```text
valid message.send -> message.accepted + message.new
same clientMessageId twice -> one database row + duplicate=true
unknown conversation -> CHAT_CONVERSATION_NOT_FOUND
non-member direct/group send -> CHAT_CONVERSATION_FORBIDDEN
invalid content -> CHAT_MESSAGE_INVALID
expired ticket -> close 1008
reused ticket -> close 1008
malformed JSON -> server.error, socket remains usable
reconnect -> new ticket + REST resync
```

The fixtures use JSON input/output snapshots so the front end and back end can be compared without relying on a live browser session.
