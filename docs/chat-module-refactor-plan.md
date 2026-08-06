# SmartCampus 聊天模块重构计划

> 状态：Phase 1-3 已落地；P1 能力（未读、通知、Redis 多实例）待后续迭代
>
> 范围：`smart-campus-api` + `smart-campus-web`
>
> 目标：把当前“单一实时大厅原型”重构为可扩展的用户通讯模块，支持实时大厅、私聊、好友、群组以及后续的未读和通知能力。

## 1. 现状判断

以下列表记录重构前基线，便于理解为什么需要本计划。

当前实现进度：会话/成员/好友/群组数据模型、REST、ticket 鉴权 WebSocket、好友/私聊/群组前端入口已经接入；消息回放、未读投影、Redis 多实例和更丰富的消息类型仍按 P1 规划。

当前实现可以作为大厅 Demo，但还不是通讯系统的基础版本：

- 后端只有 `GET /api/chat/history`，没有会话、成员、好友、群组等领域模型。
- `message.receiver_id` 同时表达大厅和私聊，语义不稳定，也无法表达群组成员关系。
- WebSocket 直接接收客户端传来的 `userId`、`senderId`、`receiverIds`，缺少完整的身份和权限边界。
- 在线用户、连接、消息分发都保存在单个 Node 进程内存中。
- 消息没有稳定的客户端幂等 ID、服务端确认、失败状态、游标分页和已读状态。
- 前端 `ChatRoom.vue` 将连接、历史、在线用户、消息列表、输入框和样式集中在一个文件中。
- 当前聊天表 `message` 与 Agent 的 `chatmessages` 是两个不同用途，重构时必须继续分离。

相关现有代码：

- API：`src/controllers/chatController.js`
- API：`src/services/chatService.js`
- API：`src/repositories/messageRepository.js`
- API：`src/websocket/index.js`
- Web：`smart-campus-web/src/view/ChatRoom.vue`
- Web：`smart-campus-web/src/websocket.js`

## 2. 产品目标与边界

### 2.1 第一版用户体验

进入 `/chat` 后，默认展示全站实时大厅：

1. 顶部为主内容区：全站实时大厅消息流。
2. 大厅支持历史消息、实时消息、在线人数、发送文本消息。
3. 页面下方或侧边提供通讯功能入口：
   - 私聊
   - 好友
   - 群组
   - 好友申请
   - 我的群组
   - 未读消息
4. 点击私聊或群组后，进入对应会话；刷新页面后仍能恢复当前会话。
5. 断线时用户可以看到连接状态，消息不会静默丢失。

### 2.2 功能范围

#### P0 必须支持

- 全站实时大厅
- 文本消息
- 历史消息分页
- WebSocket 实时收发
- 登录身份校验
- 消息发送确认和失败反馈
- 好友搜索
- 好友申请、同意、拒绝、删除
- 一对一私聊
- 创建群组
- 邀请、退出和移除群成员
- 群主、管理员、普通成员权限

#### P1 支持

- 未读数
- 已读位置
- 在线状态
- 会话置顶
- 消息撤回
- 回复消息
- 图片消息
- 群公告
- 黑名单

#### 暂不纳入第一版

- 语音和视频通话
- 端到端加密
- 多端消息同步的复杂冲突解决
- 大文件上传
- 消息搜索全文索引
- 推荐群组和推荐好友

## 3. 核心设计原则

### 3.1 会话是消息的唯一归属

所有消息必须属于一个 `conversation`，不再使用 `receiver_id` 推断消息类型。

```text
hall conversation
direct conversation
group conversation
```

发送消息时客户端只提交 `conversationId`，服务器根据当前用户和会话成员关系决定接收者。

### 3.2 身份由服务端决定

- WebSocket 不信任客户端传入的 `senderId`。
- REST 不信任客户端传入的 `userId`。
- WebSocket 建连后从 JWT 或短期 ticket 得到 `userId`。
- 发送私聊或群聊消息前，服务端验证用户是否有权限进入该会话。

#### 大厅访问策略（Phase 1 固定）

第一版采用 `authenticated_users` 策略：

- `userlist` 中存在且账号状态正常的登录用户，自动拥有大厅读取和发言权限。
- 大厅不写入每个用户的 `chat_conversation_members` 记录。
- 不额外做白名单，也不允许匿名读写。
- 被封禁、注销或账号状态异常的用户由 `chatPolicy.canAccessHall(user)` 拒绝。
- 后续如果需要校园范围、年级范围或管理员审核，只替换 policy，不改变消息表结构。

因此“大厅访问者”的判定不是客户端是否加入过房间，而是：

```text
authenticated user
  + account is active
  + chat policy allows hall access
```

### 3.3 REST 管持久数据，WebSocket 管实时事件

- REST：会话列表、历史消息、好友关系、群组管理、已读位置。
- WebSocket：新消息、发送确认、在线状态、好友事件、群成员事件。
- 页面刷新、断线重连后，以 REST 数据为准，再接收 WebSocket 增量事件。

### 3.4 消息写入必须幂等

客户端每次发送生成 `clientMessageId`。服务端对同一个用户、同一个会话的 `clientMessageId` 建唯一约束，重试不会产生重复消息。

### 3.5 Agent 历史永远不进入聊天域

`chatmessages` 继续只服务 Agent / AI 对话；新聊天模块使用独立的 `chat_*` 表和接口。

## 4. 数据模型

### 4.1 `chat_conversations`

会话主表。

| 字段               | 类型              | 说明                        |
| ------------------ | ----------------- | --------------------------- |
| `id`               | BIGINT UNSIGNED   | 会话 ID                     |
| `type`             | ENUM              | `hall` / `direct` / `group` |
| `name`             | VARCHAR           | 群组名称；大厅和私聊可为空  |
| `avatar_url`       | VARCHAR           | 群头像或会话头像            |
| `owner_id`         | INT UNSIGNED      | 群主；大厅为空              |
| `status`           | ENUM              | `active` / `archived`       |
| `last_message_id`  | BIGINT UNSIGNED   | 列表预览和排序用            |
| `direct_user_low`  | INT UNSIGNED NULL | direct 会话中较小的用户 ID  |
| `direct_user_high` | INT UNSIGNED NULL | direct 会话中较大的用户 ID  |
| `created_at`       | DATETIME          | 创建时间                    |
| `updated_at`       | DATETIME          | 最近活动时间                |

约束：

- 全库只存在一个 `type = hall` 的大厅会话。
- `direct` 会话必须同时写入 `direct_user_low` 和 `direct_user_high`，并满足 `low < high`。
- 增加唯一键 `UNIQUE KEY uk_direct_pair (direct_user_low, direct_user_high)`。
- `hall` 和 `group` 的 direct 字段为 NULL；MySQL 唯一索引允许多行 NULL。
- `group` 会话由 owner 创建。

创建 direct 会话的事务流程：

1. 服务端取得当前用户和目标用户 ID，拒绝两者相同。
2. 计算 `low = LEAST(userA, userB)`、`high = GREATEST(userA, userB)`。
3. 尝试插入 `(type = 'direct', low, high)`。
4. 遇到唯一键冲突时读取已有会话并返回，不创建第二个会话。

现有 `userlist.id` 是 `INT UNSIGNED`，新聊天表中的所有 `user_id`、`owner_id`、`requester_id`、`addressee_id` 统一使用 `INT UNSIGNED`，不要继续扩大成 BIGINT 或混用 VARCHAR。

### 4.2 `chat_conversation_members`

会话成员和权限表。

| 字段                   | 类型            | 说明                          |
| ---------------------- | --------------- | ----------------------------- |
| `conversation_id`      | BIGINT UNSIGNED | 会话 ID                       |
| `user_id`              | INT UNSIGNED    | 用户 ID                       |
| `role`                 | ENUM            | `owner` / `admin` / `member`  |
| `status`               | ENUM            | `active` / `left` / `removed` |
| `last_read_message_id` | BIGINT UNSIGNED | 已读位置                      |
| `joined_at`            | DATETIME        | 入群时间                      |
| `last_read_at`         | DATETIME        | 最近已读时间                  |

唯一键：`(conversation_id, user_id)`。

大厅采用上文定义的 `authenticated_users` 访问策略，不为所有用户批量插入成员记录；群组和私聊仍必须使用成员表。

### 4.3 `chat_messages`

消息表。

| 字段                | 类型            | 说明                        |
| ------------------- | --------------- | --------------------------- |
| `id`                | BIGINT UNSIGNED | 服务端消息 ID               |
| `conversation_id`   | BIGINT UNSIGNED | 所属会话                    |
| `sender_id`         | INT UNSIGNED    | 服务端解析的发送者          |
| `client_message_id` | VARCHAR(64)     | 客户端幂等 ID               |
| `type`              | ENUM            | `text` / `image` / `system` |
| `content`           | JSON            | 文本或结构化内容            |
| `reply_to_id`       | BIGINT UNSIGNED | 回复的消息，可为空          |
| `created_at`        | DATETIME        | 创建时间                    |
| `edited_at`         | DATETIME        | 编辑时间                    |
| `recalled_at`       | DATETIME        | 撤回时间                    |
| `deleted_at`        | DATETIME        | 软删除时间                  |

索引：

- `(conversation_id, id DESC)`：历史分页。
- `(conversation_id, created_at DESC)`：会话排序。
- `(sender_id, conversation_id, client_message_id)`：幂等写入。

### 4.4 `chat_friendships`

好友关系表。

| 字段           | 类型            | 说明                                            |
| -------------- | --------------- | ----------------------------------------------- |
| `id`           | BIGINT UNSIGNED | 申请 ID                                         |
| `requester_id` | INT UNSIGNED    | 发起人                                          |
| `addressee_id` | INT UNSIGNED    | 接收人                                          |
| `status`       | ENUM            | `pending` / `accepted` / `rejected` / `blocked` |
| `remark`       | VARCHAR         | 申请备注                                        |
| `created_at`   | DATETIME        | 申请时间                                        |
| `updated_at`   | DATETIME        | 状态更新时间                                    |

应用层将用户对规范化为较小 ID 在前、较大 ID 在后的 pair，避免重复好友关系。

### 4.5 `chat_group_invites`

群邀请和入群申请表。第一版可以合并邀请和申请，但状态必须明确：

```text
pending
accepted
rejected
cancelled
expired
```

### 4.6 可选表

后续根据产品需要增加：

- `chat_message_receipts`：精确到用户的送达和已读状态。
- `chat_user_blocks`：拉黑关系。
- `chat_conversation_settings`：免打扰、置顶、隐藏。
- `chat_attachments`：图片和文件元数据。

### 4.7 `chat_socket_tickets`

WebSocket ticket 使用数据库保存哈希，支持一次性消费和多实例部署：

| 字段         | 类型            | 说明                       |
| ------------ | --------------- | -------------------------- |
| `id`         | BIGINT UNSIGNED | ticket ID                  |
| `user_id`    | INT UNSIGNED    | 所属用户                   |
| `token_hash` | BINARY(32)      | 原始 ticket 的 SHA-256     |
| `expires_at` | DATETIME        | 过期时间，默认签发后 60 秒 |
| `used_at`    | DATETIME NULL   | 成功建连后写入             |
| `created_at` | DATETIME        | 创建时间                   |

索引：`UNIQUE(token_hash)`、`(user_id, expires_at)`。

## 5. REST API 规划

统一前缀：`/api/chat`。所有接口要求登录，用户 ID 从 JWT 获取。

### 5.1 会话

```text
GET    /api/chat/conversations
GET    /api/chat/conversations/:conversationId
POST   /api/chat/conversations/direct
POST   /api/chat/conversations/group
PATCH  /api/chat/conversations/:conversationId
DELETE /api/chat/conversations/:conversationId/membership
```

会话列表返回：

```json
{
  "id": 12,
  "type": "direct",
  "name": "张三",
  "avatarUrl": null,
  "lastMessage": {
    "id": 901,
    "content": "晚上一起讨论项目吗？",
    "createdAt": "2026-08-06T12:30:00.000Z"
  },
  "unreadCount": 2,
  "updatedAt": "2026-08-06T12:30:00.000Z"
}
```

### 5.2 历史消息

```text
GET /api/chat/conversations/:conversationId/messages?limit=30&before=901
```

返回：

```json
{
  "items": [],
  "hasMore": true,
  "nextBefore": 871
}
```

使用消息 ID 游标，不使用页码，避免实时插入导致翻页重复或遗漏。

### 5.3 好友

```text
GET    /api/chat/users/search?q=...
GET    /api/chat/friends
GET    /api/chat/friend-requests
POST   /api/chat/friend-requests
PATCH  /api/chat/friend-requests/:id
DELETE /api/chat/friends/:userId
POST   /api/chat/users/:userId/block
DELETE /api/chat/users/:userId/block
```

### 5.4 群组

```text
GET    /api/chat/groups
GET    /api/chat/groups/:groupId
GET    /api/chat/groups/:groupId/members
POST   /api/chat/groups/:groupId/invites
POST   /api/chat/groups/:groupId/members
DELETE /api/chat/groups/:groupId/members/:userId
PATCH  /api/chat/groups/:groupId/members/:userId/role
POST   /api/chat/groups/:groupId/leave
```

### 5.5 已读与连接 ticket

```text
POST /api/chat/conversations/:conversationId/read
POST /api/chat/socket-ticket
```

#### ticket 生命周期

1. 前端通过已认证的 REST 请求调用 `POST /api/chat/socket-ticket`。
2. 服务端生成至少 32 字节的随机原始 ticket，只把 `SHA-256(ticket)` 写入 `chat_socket_tickets`。
3. 接口只返回一次原始 ticket 和过期时间：

   ```json
   {
     "ticket": "base64url-random-value",
     "expiresAt": "2026-08-06T12:31:00.000Z"
   }
   ```

4. 浏览器原生 WebSocket 无法稳定设置 `Authorization` header，因此使用：

   ```text
   wss://host/chat?ticket=<short-lived-ticket>
   ```

5. WebSocket 服务端按哈希查询 ticket，并在同一事务内执行：

   ```text
   token_hash = hash(ticket)
   AND used_at IS NULL
   AND expires_at > NOW()
   -> UPDATE used_at = NOW()
   -> 读取 user_id，建立 authenticated connection context
   ```

6. ticket 只允许成功消费一次，成功建连后不能复用。
7. 连接断开或重连时，前端重新调用 `/socket-ticket` 获取新 ticket，不能复用旧 ticket。
8. 服务端签发新 ticket 时可以顺便清理已过期记录；不把原始 ticket 写日志。
9. ticket 无效、已使用或过期时，WebSocket 使用策略违规关闭码 `1008` 关闭，不进入匿名聊天状态。

ticket 虽然暂时出现在 URL 中，但它是一次性、60 秒有效的随机值；长期 JWT 不进入 WebSocket URL。

## 6. WebSocket 协议规划

### 6.0 建连握手

```text
POST /api/chat/socket-ticket  (Authorization: JWT)
        |
        v
WebSocket /chat?ticket=...
        |
        v
connection.ready { userId, serverTime, heartbeatInterval }
```

连接建立后，服务端只使用 ticket 解析出的 `userId`，忽略 URL 中任何客户端自报的用户 ID。

### 6.1 统一包结构

客户端命令：

```json
{
  "requestId": "req_01",
  "type": "message.send",
  "payload": {
    "conversationId": 12,
    "clientMessageId": "msg_01",
    "messageType": "text",
    "content": "你好"
  }
}
```

服务端事件：

```json
{
  "eventId": "evt_01",
  "type": "message.new",
  "serverTime": "2026-08-06T12:30:00.000Z",
  "data": {
    "message": {}
  }
}
```

### 6.2 客户端命令

```text
connection.ping
message.send
message.retry
message.read
conversation.subscribe
conversation.unsubscribe
presence.subscribe
```

好友、群组等关系变更优先走 REST，成功后由服务端广播事件，避免所有业务写操作都堆在 WebSocket handler 中。

### 6.3 服务端事件

```text
connection.ready
message.accepted
message.new
message.failed
message.recalled
conversation.updated
conversation.member_added
conversation.member_removed
friend.requested
friend.updated
presence.updated
message.read
server.error
```

### 6.4 连接可靠性

`useChatSocket` 需要统一处理：

- 连接状态：`idle` / `connecting` / `open` / `reconnecting` / `closed`。
- 指数退避重连，设置最大重试间隔。
- 心跳和服务端超时检测。
- 待确认消息队列。
- 收到 `message.accepted` 后将 optimistic 消息替换为服务端消息。
- 断线期间的发送消息进入 outbox，重连后按 `clientMessageId` 重试。
- 收到重复事件时按 `eventId` 或 `message.id` 去重。

## 7. 后端代码重构

### 7.1 目录结构

建议将当前聊天相关代码整理为：

```text
src/chat/
├── chatPolicy.js
├── chatProtocol.js
├── chatValidators.js
├── presenceStore.js
├── inMemoryPresenceStore.js
└── websocket/
    ├── chatSocketServer.js
    ├── connectionContext.js
    └── eventDispatcher.js

src/controllers/chatController.js
src/services/chatService.js
src/services/friendService.js
src/services/groupService.js
src/repositories/chatConversationRepository.js
src/repositories/chatMemberRepository.js
src/repositories/chatMessageRepository.js
src/repositories/chatFriendRepository.js
src/repositories/chatGroupRepository.js
```

### 7.1.1 PresenceStore 接口

业务代码不得直接访问 `Map<userId, Set<WebSocket>>`。先定义稳定接口，第一版使用内存实现，未来切换 Redis 只替换实现和装配代码：

```js
class PresenceStore {
  async connect({ userId, connectionId, metadata }) {}
  async disconnect({ userId, connectionId }) {}
  async touch({ userId, connectionId }) {}
  async isOnline(userId) {}
  async getOnlineUserIds() {}
  async getConnections(userId) {}
}
```

实现约束：

- `InMemoryPresenceStore` 只保存当前进程的连接，不进入业务 service。
- `RedisPresenceStore` 未来保存 user 到 connection 的映射和 TTL。
- 跨实例消息广播另设 `ChatEventBus` 接口，不把 Redis 发布订阅逻辑塞进 PresenceStore。
- `chatSocketServer` 只依赖接口，不依赖具体 Map 或 Redis client。

### 7.2 WebSocket handler 拆分

当前 `src/websocket/index.js` 同时处理大厅、岗位房间、在线用户和聊天消息。重构后：

- 岗位浏览房间保持现有功能，但抽成独立 room registry。
- 聊天连接由 `chatSocketServer` 管理。
- 每条消息先经过 protocol parse 和 schema validation。
- 每个连接拥有 authenticated user context。
- 业务服务负责权限和数据库写入。
- dispatcher 负责将持久化后的事件推给目标连接。

### 7.3 发送消息流程

```text
收到 message.send
  -> 校验包结构
  -> 从连接上下文取得 senderId
  -> 校验 conversation 存在
  -> 校验 sender 是大厅访问者或会话成员
  -> 校验消息长度、类型、频率
  -> 按 clientMessageId 查重
  -> 事务写入 chat_messages
  -> 更新 conversation.last_message_id / updated_at
  -> 返回 message.accepted
  -> 向目标连接广播 message.new
```

任何一步失败，都返回结构化 `message.failed`，不能静默丢弃。

## 8. 前端重构

### 8.1 页面结构

将 `smart-campus-web/src/view/ChatRoom.vue` 拆分为：

```text
src/views/Chat/
├── index.vue
├── components/
│   ├── ChatHall.vue
│   ├── ConversationList.vue
│   ├── ConversationItem.vue
│   ├── MessageList.vue
│   ├── MessageItem.vue
│   ├── MessageComposer.vue
│   ├── FriendCenter.vue
│   ├── FriendRequestList.vue
│   ├── GroupCenter.vue
│   ├── CreateGroupDialog.vue
│   └── GroupMemberDialog.vue
├── composables/
│   ├── useChatSocket.js
│   ├── useChatMessages.js
│   └── useChatScroll.js
└── chatConstants.js
```

旧 `/ChatRoom` 路由保留兼容，重定向到 `/chat`。

### 8.2 Pinia 状态

建议新增 `chat` store，采用按 ID 归一化结构：

```js
{
  activeConversationId: null,
  conversationsById: {},
  conversationIds: [],
  messagesByConversation: {},
  messageIdsByConversation: {},
  friendsById: {},
  pendingFriendRequests: [],
  onlineUserIds: new Set(),
  connectionState: 'idle',
  outbox: {},
}
```

消息渲染模型统一包含：

```text
id
clientMessageId
conversationId
sender
type
content
createdAt
status: pending / sent / failed / recalled
```

### 8.3 页面交互验收

- 首次进入默认打开大厅。
- 进入私聊或群组后，刷新仍停留在当前会话。
- 历史滚动到顶部时自动加载更早消息，滚动位置不跳动。
- 发送消息先显示 pending，服务端确认后变为 sent。
- 发送失败显示 retry，不会无反馈地消失。
- 收到其他会话消息时更新未读数，不打断当前输入。
- 当前会话收到新消息时自动追加；用户阅读后清除未读。
- WebSocket 断开时显示状态，恢复后自动同步漏掉的消息。

## 9. 旧数据迁移策略

### 9.1 旧表保留策略

当前 `message` 表先保留，不直接删除。迁移前必须先做数据审计，不能直接把 `receiver_id = '1'` 当作无条件迁移规则。

现有代码在 `src/websocket/index.js` 中把 `HALL_ID = '1'` 作为大厅的存储约定，但这与真实用户 ID `1` 可能冲突：旧表没有 `conversation_id`，也没有记录“这是大厅消息还是发给用户 1 的私聊”。因此存在不可恢复的历史歧义。

迁移前执行：

```sql
SELECT receiver_id, COUNT(*)
FROM message
GROUP BY receiver_id
ORDER BY COUNT(*) DESC;

SELECT sender_id, receiver_id, MIN(created_at), MAX(created_at), COUNT(*)
FROM message
GROUP BY sender_id, receiver_id
ORDER BY COUNT(*) DESC;

SELECT id, sender_id, receiver_id, content, created_at
FROM message
WHERE receiver_id = '1'
ORDER BY id
LIMIT 200;
```

结合旧前端行为、部署时间和抽样数据确认哪些行确实属于大厅。对于无法判定的行先进入 `chat_legacy_messages` 暂存表，标记 `migration_status = 'needs_review'`，不能静默归入大厅或私聊。

确认规则后再执行：

1. 创建唯一大厅会话。
2. 已确认的大厅行迁移到大厅。
3. 已确认的 direct 行按发送者和接收者创建私聊会话。
4. 迁移消息时保留原始 `created_at`、旧消息 ID 和原始 receiver 值。
5. 记录迁移数量、异常行和无法识别的用户。
6. 新代码切换到 `chat_messages` 后，将旧表改为只读观察期。
7. 观察期结束后再决定是否删除旧表。

### 9.2 兼容接口

第一阶段可以保留：

```text
GET /api/chat/history
```

内部改为读取大厅会话，避免旧前端或旧链接立即失效。新前端切换到 conversations API 后，再逐步废弃该接口。

## 10. 分阶段实施计划

### Phase 0：冻结契约和建模

任务：

- [x] 定义大厅、私聊、群组、好友的业务规则。
- [x] 定义会话成员权限矩阵。
- [x] 确定消息类型和长度限制。
- [x] 创建新表 SQL 和迁移脚本。
- [x] 明确所有新表用户外键使用 `INT UNSIGNED`，与 `userlist.id` 对齐。
- [x] 为 direct 会话写出 `direct_user_low` / `direct_user_high` 字段、唯一索引和并发创建事务。
- [x] 为大厅写出 `authenticated_users` 访问 policy 和账号状态检查。
- [x] 为 `chat_socket_tickets` 写出生成、哈希存储、一次性消费、过期和重连流程。
- [x] 定义 REST response schema。
- [x] 定义 WebSocket command/event schema。
- [x] 确定错误码和鉴权方式。
- [ ] 定义 `PresenceStore` 和 `ChatEventBus` 接口，以及内存实现的装配方式。
- [ ] 对旧 `message` 表执行 receiver 分布审计，确认 `receiver_id = '1'` 的历史歧义处理规则。
- [ ] 准备一组 WebSocket 协议 fixture，覆盖正常包、非法包、重复包、乱序事件和重连。

验收：

- 前后端可以只根据文档实现同一套协议，ticket、权限、幂等和错误边界没有口头约定。
- 不再需要 `receiverIds` 推断消息接收者。
- Node 和 Web 各自运行协议 fixture，对同一组输入得到一致的事件和错误结果。
- direct 会话并发创建只产生一个会话。
- 历史迁移脚本对无法分类的旧消息会阻断或进入人工复核，不会静默错迁。

### Phase 1：大厅 MVP

任务：

- [x] 创建 conversations/members/messages 表。
- [x] 实现大厅会话初始化。
- [x] 实现大厅历史游标分页。
- [x] 实现 WebSocket ticket 和严格鉴权。
- [x] 实现 `message.send`、`message.accepted`、`message.new`。
- [x] 实现 clientMessageId 幂等。
- [x] 重写前端 ChatPage、ChatHall 和 MessageList。
- [x] 增加断线重连和失败重试。
- [ ] 迁移旧大厅消息。

验收：

- 两个账号可以实时通信。
- 同一消息重试不会重复入库。
- 未登录用户不能读取或发送大厅消息。
- 断线重连后消息不会明显丢失。

### Phase 2：好友和私聊

任务：

- [ ] 用户搜索接口。
- [ ] 好友申请状态机。
- [ ] 同意后创建或获取唯一 direct conversation。
- [ ] 好友列表和申请列表页面。
- [ ] 私聊消息权限校验。
- [ ] 私聊未读数和最近消息预览。
- [ ] 删除好友、拉黑规则。

验收：

- 非好友不能开始私聊，除非产品明确允许。
- 私聊消息只会推送给会话成员。
- 非成员无法通过 REST 或 WebSocket 读取私聊历史。

### Phase 3：群组

任务：

- [ ] 创建群组。
- [ ] 邀请好友入群。
- [ ] 群成员列表。
- [ ] 群主转让、管理员设置。
- [ ] 移除成员和主动退群。
- [ ] 群系统消息。
- [ ] 群名、头像和公告。

验收：

- 群权限由后端强制执行。
- 被移除成员立即不能发送新消息。
- 成员变更在在线用户之间实时同步。

### Phase 4：消息体验

任务：

- [ ] 已读位置和未读数。
- [ ] 会话置顶和免打扰。
- [ ] 消息撤回。
- [ ] 回复消息。
- [ ] 图片上传和图片消息。
- [ ] 用户在线状态和最近在线时间。

验收：

- 用户刷新和重新登录后未读状态正确。
- 消息撤回在历史加载和实时事件中表现一致。

### Phase 5：稳定性和发布

任务：

- [ ] REST 接口测试。
- [ ] WebSocket 双用户集成测试。
- [ ] 群聊多用户集成测试。
- [ ] 断线、重连、重复发送测试。
- [ ] WebSocket 协议 fixture 对拍测试。
- [ ] 越权访问测试。
- [ ] 消息发送限流和内容长度限制。
- [ ] 结构化日志和关键指标。
- [ ] 旧表观察期和清理方案。

验收：

- 所有 P0 功能有自动化测试。
- 服务端不依赖单个页面实例维持消息一致性。
- 发布和回滚步骤明确。

## 11. 安全要求

- WebSocket 必须验证 JWT 或短期 ticket，不能只接受 URL 中的 `userId`。
- 所有消息发送、历史读取、成员管理都做服务端权限校验。
- 对文本做长度、编码和频率限制。
- 对图片和文件做 MIME、大小、扩展名校验。
- 不将完整 token 写入日志。
- 对好友、群组和私聊历史执行用户隔离。
- 防止用户通过伪造 `conversationId` 读取其他会话。
- 处理 WebSocket 连接数和单用户多连接限制。

## 12. 可靠性和性能要求

- 历史消息必须使用游标分页，不允许每次拉全量。
- 消息写入使用唯一幂等键。
- WebSocket 事件必须可去重。
- 单个连接异常不能影响其他连接。
- 多实例部署时，在线状态和广播需要 Redis 或消息总线；第一版使用 `InMemoryPresenceStore`，但所有业务代码只依赖 `PresenceStore` 和 `ChatEventBus` 接口。
- 大厅消息需要限流和历史保留策略，避免无限增长。
- 消息广播必须在数据库写入成功后发生，避免客户端看到不存在的消息。

## 13. 建议的第一批交付物

下一步先产出并评审以下三个文件，再开始写业务代码：

1. `docs/chat-data-model.sql`：新表和索引。
2. `docs/chat-api-contract.md`：REST 接口和错误码。
3. `docs/chat-websocket-protocol.md`：命令、事件、重连和幂等协议。

三个契约确认后，先完成 Phase 1 大厅 MVP，再进入好友、私聊和群组，不把所有功能一次性塞进一个大改动里。
