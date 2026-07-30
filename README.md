# smart-campus-api

大学智学网后端服务。**Koa2 + MySQL + JWT + WebSocket + OpenAI**,分层架构。

配套前端:https://github.com/skkka-2/smart-campus-web

## 技术栈

- **Node.js** ≥ 18
- **Koa2** —— HTTP 服务
- **mysql2** —— 数据库(MySQL 8.x / 9.x)
- **jsonwebtoken** + **bcryptjs** —— 鉴权 & 密码
- **ws** —— 聊天室 WebSocket
- **openai** —— AI 助手(chatanywhere 兼容代理)
- **nodemon** —— dev 热重载
- **eslint** + **prettier** —— 代码质量

## 目录结构

```
smart-campus-api/
├── src/
│   ├── app.js                # 入口:装配中间件 + 路由 + WS + graceful shutdown
│   ├── config/               # 环境变量、常量
│   ├── db/                   # MySQL 连接池
│   ├── middleware/
│   │   ├── error.js          # 全局异常兜底 + BizError 处理
│   │   ├── auth.js           # requireAuth / optionalAuth
│   │   ├── logger.js         # 请求日志
│   │   └── cors.js           # CORS 白名单
│   ├── routes/               # koa-router 组装,per-route 挂 auth
│   ├── controllers/          # HTTP I/O 层,只做 req→service→ctx.success/fail
│   ├── agent/                # 智学助手:prompt / memory / tools / runner / trace
│   ├── services/             # 业务逻辑,抛 BizError
│   ├── repositories/         # SQL 层,一表一文件
│   ├── utils/                # 响应包装、jwt、分页
│   └── websocket/            # WebSocket handler(连接级作用域)
├── schema.sql                # 数据库初始化(建库 + 建表 + 种子数据)
├── .env.example              # 环境变量模板
├── eslint.config.js
├── .prettierrc.json
└── package.json
```

## 从零到跑起来

### 1. 装依赖

```bash
npm install
```

### 2. 装 MySQL 并初始化数据库

```bash
brew install mysql
brew services start mysql
mysql_secure_installation   # 设置 root 密码
mysql -u root -p < schema.sql
```

也可以在 Sequel Ace / DBeaver 里粘贴 `schema.sql` 执行。

### 3. 配置 .env

```bash
cp .env.example .env
```

必填字段:
- `MYSQL_PASSWORD` —— MySQL root 密码
- `JWT_SECRET` —— 长随机字符串
- `OPENAI_API_KEY` —— AI 对话接口的 key(可选,不填 AI 页面不可用)

### 4. 启动

```bash
npm run dev
```

看到下面这三行说明成功:
```
[db] connected: root@127.0.0.1:3306/item_01
[ws] WebSocket ready
[app] server listening on http://localhost:3007
```

## 架构约定

**分层职责**:
- **routes/** 只做 URL → controller 绑定,per-route 挂 `requireAuth`(不是全局黑名单)
- **controllers/** 只做 HTTP 层(读 req、调 service、`ctx.success/fail`)
- **services/** 写业务逻辑,抛 `BizError`(见 `utils/response.js`)
- **repositories/** 只写 SQL,不感知 HTTP;一表一文件

**统一响应格式**:
```json
{ "code": 0, "message": "ok", "data": {...} }
```
- `code: 0` = 成功;非 0 为业务错误码
- HTTP 状态码正常使用(200 / 400 / 401 / 404 / 500)
- 前端只需检查 `res.data.code === 0`

**鉴权**:
- `requireAuth`:强制登录,失败抛 `BizError.unauthorized`
- `optionalAuth`:有 token 就解析(用于详情页附带 `liked` 状态),没 token 也放行
- 公共接口(注册、登录、文章列表、榜单、分类)一律无需 token

**错误处理**:controller 里不写 try/catch,直接抛 `BizError`(或让异常冒泡),全局 error middleware 兜住并返回规范格式。

## 数据模型

7 张核心表(见 `schema.sql`):

| 表 | 用途 |
|----|------|
| `userlist` | 用户账号(username+bcrypt+phone) |
| `category` | 内容分类(7 个种子:all/focus/campus/grad/cert/match/innov) |
| `article` | 文章主表(合并旧 recommendlist+likelist,`sort_type` 区分推荐/最新) |
| `article_like` | 点赞关系表(UNIQUE article_id+user_id,cascade 删) |
| `comment` | 评论(带 article_id 外键 + userName 兼容旧数据) |
| `layoutlist` | 首页右侧三个榜单的数据源 |
| `message` / `chatmessages` | 聊天室 / AI 对话历史 |

## 接口速览

### 用户
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| POST | `/api/users/register` | ✗ | body: `{ username, password, phone }` |
| POST | `/api/users/login` | ✗ | 返回 `{ token: "Bearer xxx", user: { id, username } }` |
| GET  | `/api/users/me` | ✓ | 当前登录用户 |

### 文章
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| GET  | `/api/articles?sort=recommend\|latest\|all&category=<slug>&page=1&limit=5` | ✗ | 支持分类过滤 |
| GET  | `/api/articles/:id` | ~ | optionalAuth:登录用户额外拿到 `liked` 标记 |
| GET  | `/api/articles/rankings` | ✗ | 首页右侧三榜 |
| POST | `/api/articles` | ✓ | body: `{ content, title?, categoryId? }` |
| POST | `/api/articles/:id/like` | ✓ | 切换点赞;返回 `{ liked, likeCount }` |

### 分类
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| GET | `/api/categories` | ✗ | 所有分类,按 sort_order 排序 |

### 评论
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| GET  | `/api/articles/:articleId/comments` | ✗ | 某文章下的评论(分页) |
| POST | `/api/articles/:articleId/comments` | ✓ | body: `{ content }` |
| GET  | `/api/comments?page=1&limit=20` | ✗ | 全站评论列表 |
| POST | `/api/comments/query` | ✗ | body: `{ userName }`(兼容旧接口) |
| POST | `/api/comments` | ✓ | body: `{ content }`(不绑定文章) |

### AI 助手与 Agent(全部需登录)
| Method | Path | 说明 |
|--------|------|------|
| POST   | `/api/ai/chat` | body: `{ content }`;从 JWT 取 userId |
| GET    | `/api/ai/history` | 拉取当前用户历史对话 |
| DELETE | `/api/ai/history` | 清空当前用户对话 |
| POST   | `/api/agent/stream` | SSE;body: `{ message, context?: { jobId } }` |
| GET    | `/api/agent/history` | 拉取 Agent 对话历史和工具轨迹 |
| DELETE | `/api/agent/history` | 清空 Agent 对话历史 |
| POST   | `/api/agent/actions/confirm` | 确认高风险工具,如投递岗位 |

## Agent 架构

`src/agent/` 把原来的 AI 对话拆成 5 个可讲清楚的模块:

- `prompt.js`:系统提示词,限定它是校园服务/就业助手。
- `memoryService.js`:按用户加载近期对话,并把 assistant metadata 存成工具轨迹。
- `toolRegistry.js`:统一登记工具 schema、handler、展示摘要和确认策略。
- `runner.js`:OpenAI tool calling 循环;失败时切到 mock agent,保证演示可用。
- `traceService.js`:统一 SSE 事件,前端可以逐步渲染思考、工具调用、结果和最终回答。

工具调用结果统一返回:
```json
{
  "ok": true,
  "data": {},
  "display": { "summary": "找到 5 个岗位" }
}
```

SSE 事件约定:

| type | 用途 |
|------|------|
| `thinking` | Agent 开始一轮推理 |
| `tool_call` | 即将调用业务工具 |
| `tool_result` | 工具完成,含 `ok/summary/result` |
| `action_required` | 需要用户确认的高风险动作,如 `apply_job` |
| `final` | 最终自然语言回答 |
| `mock_fallback` | OpenAI 不可用时切到本地规则兜底 |

业务集成示例:
- 岗位详情页跳转 `/agent?jobId=12&prompt=为什么这个岗位适合我`。
- 前端向 `/api/agent/stream` 发送 `{ message, context: { jobId: 12 } }`。
- `runner` 把 jobId 写入上下文提示,模型优先调用 `get_job_detail` 和 `get_my_profile`,再输出匹配理由。

### 聊天室(WebSocket)
| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/chat/history?limit=10` | 最新 N 条群聊 |
| WS  | `ws://host:3007/?userId=xxx&token=xxx` | 消息格式 `{ senderId, receiverIds, content }` |

### 其它
| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/health` | 存活检查 |

## 开发

```bash
npm run dev      # nodemon 热重载
npm start        # 直接 node
npm run lint     # eslint
npm run format   # prettier 格式化
```

## 关联仓库

- 前端:https://github.com/skkka-2/smart-campus-web
