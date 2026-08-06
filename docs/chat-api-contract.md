# Chat REST API Contract

Base path: `/api/chat`

All endpoints require authentication. The current user is always taken from JWT middleware; request bodies must not contain an authoritative `userId`.

## Common response

Successful responses use the existing project envelope:

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

Business errors use stable codes:

```text
CHAT_CONVERSATION_NOT_FOUND
CHAT_CONVERSATION_FORBIDDEN
CHAT_MESSAGE_INVALID
CHAT_MESSAGE_DUPLICATE
CHAT_FRIEND_REQUEST_INVALID
CHAT_GROUP_FORBIDDEN
CHAT_SOCKET_TICKET_INVALID
CHAT_RATE_LIMITED
```

## Socket ticket

### `POST /api/chat/socket-ticket`

Creates a one-time WebSocket ticket for the authenticated user.

```json
{
  "ttlSeconds": 60,
  "ticket": "base64url-random-value",
  "expiresAt": "2026-08-06T12:31:00.000Z"
}
```

The raw ticket is never persisted or logged. The server persists SHA-256(ticket) in `chat_socket_tickets`. A ticket is consumed once during the WebSocket handshake. Reconnects must request a new ticket.

## Conversations

### `GET /api/chat/conversations`

Returns the current user's conversations ordered by `updatedAt DESC`.

Query parameters:

```text
type=all|direct|group
limit=1..50
```

Response item:

```json
{
  "id": 12,
  "type": "direct",
  "name": "张三",
  "avatarUrl": null,
  "memberCount": 2,
  "lastMessage": {
    "id": 901,
    "type": "text",
    "content": { "text": "晚上一起讨论项目吗？" },
    "senderId": 7,
    "sender": { "id": 7, "username": "张三", "avatarUrl": null },
    "createdAt": "2026-08-06T12:30:00.000Z"
  },
  "updatedAt": "2026-08-06T12:30:00.000Z"
}
```

The hall is always included as the first system conversation for an authenticated user.

### `POST /api/chat/conversations/direct`

Creates or returns the unique direct conversation between the current user and `userId`.

```json
{ "userId": 7 }
```

The service canonicalizes the pair into `direct_user_low` and `direct_user_high`, then handles a unique-key race by reading the existing conversation.

### `POST /api/chat/conversations/group`

Creates a group and adds the current user as owner.

```json
{
  "name": "前端实习讨论组",
  "memberIds": [7, 8, 9]
}
```

The creator must be a valid active user. Initial members are validated before the group transaction commits.

### `PATCH /api/chat/conversations/:conversationId`

Allowed for group owner/admin only:

```json
{
  "name": "新的群名",
  "avatarUrl": null
}
```

## Messages

### `GET /api/chat/conversations/:conversationId/messages`

Returns messages in ascending display order.

Query parameters:

```text
limit=1..50
before=<message id> optional
```

Response:

```json
{
  "items": [
    {
      "id": 901,
      "conversationId": 12,
      "clientMessageId": "msg_01",
      "senderId": 7,
      "sender": {
        "id": 7,
        "username": "张三",
        "avatarUrl": null
      },
      "type": "text",
      "content": { "text": "你好" },
      "replyToId": null,
      "createdAt": "2026-08-06T12:30:00.000Z",
      "editedAt": null,
      "recalledAt": null
    }
  ],
  "hasMore": true,
  "nextBefore": 871
}
```

The caller must be an active member, or the authenticated hall policy must allow access to the hall. The API must not return a conversation's messages before this check.

### `POST /api/chat/conversations/:conversationId/read`

Updates the member's read cursor.

```json
{ "messageId": 901 }
```

The message must belong to the target conversation. A client cannot mark an unrelated conversation as read.

## Friends

```text
GET    /api/chat/users/search?q=<keyword>&limit=20
GET    /api/chat/friends
GET    /api/chat/friend-requests?direction=incoming|outgoing
POST   /api/chat/friend-requests       { addresseeId, remark? }
PATCH  /api/chat/friend-requests/:id   { action: accept|reject }
DELETE /api/chat/friends/:userId
POST   /api/chat/users/:userId/block
DELETE /api/chat/users/:userId/block
```

Friend requests are state transitions. The service verifies that the current user is the requester or addressee before changing a row.

## Groups

```text
GET    /api/chat/groups/:groupId
GET    /api/chat/groups/:groupId/members
GET    /api/chat/group-invites
POST   /api/chat/groups/:groupId/invites      { inviteeId }
PATCH  /api/chat/group-invites/:id            { action: accept|reject }
POST   /api/chat/groups/:groupId/members      { userId }
DELETE /api/chat/groups/:groupId/members/:userId
PATCH  /api/chat/groups/:groupId/members/:userId/role { role }
POST   /api/chat/groups/:groupId/leave
```

All member mutations pass through one group policy service. The client never decides whether it is allowed to remove or promote a member.
