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

也可以在 Sequel Ace / DBeaver 里执行；如果客户端不支持 mysql 的 `SOURCE` 命令，先执行
`schema.sql`，再单独执行 `docs/chat-data-model.sql`。

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

`src/agent/` 把原来的 AI 对话拆成 7 个可讲清楚的模块:

- `prompt.js`:系统提示词,限定它是校园服务/就业助手。
- `llmClient.js`:统一创建 OpenAI 兼容客户端,兼容 GLM/DeepSeek 等 baseURL。
- `intentExtractor.js`:用 `response_format: { type: "json_object" }` 做意图/槽位抽取,不支持时自动降级。
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
| `intent` | JSON Mode 抽取出的意图、置信度和 slots |
| `thinking` | Agent 开始一轮推理 |
| `tool_call` | 即将调用业务工具 |
| `tool_result` | 工具完成,含 `ok/summary/result` |
| `action_required` | 需要用户确认的高风险动作,如 `apply_job` |
| `delta` | LLM token/chunk 级流式文本增量 |
| `final` | 最终完整回答,用于收尾和持久化校准 |
| `mock_fallback` | OpenAI 不可用时切到本地规则兜底 |

业务集成示例:
- 岗位详情页跳转 `/agent?jobId=12&prompt=为什么这个岗位适合我`。
- 前端向 `/api/agent/stream` 发送 `{ message, context: { jobId: 12 } }`。
- `runner` 把 jobId 写入上下文提示,模型优先调用 `get_job_detail` 和 `get_my_profile`,再输出匹配理由。

### JSON Mode 意图抽取

在正式 tool calling 前,`intentExtractor` 会先让模型输出稳定 JSON:

```json
{
  "intent": "job_search",
  "confidence": 0.92,
  "slots": {
    "city": "深圳",
    "category": "前端",
    "workType": "internship",
    "degree": null,
    "salaryMin": null,
    "keyword": null,
    "jobId": null
  },
  "needsProfile": false,
  "needsConfirmation": false,
  "reason": "用户想搜索深圳前端实习"
}
```

如果当前模型兼容 `response_format`,请求会带:

```json
{ "type": "json_object" }
```

如果模型返回 `unsupported response_format` 之类错误,后端会把 JSON Mode 标记为不可用并自动重试一次普通 prompt-only JSON 抽取。这个结构化结果不会替代 tool calling,而是作为额外 system context 帮模型更稳定地选择 `list_jobs`、`recommend_jobs`、`apply_job` 等工具。

## 腾讯云 CLS Agent 可观测

本项目支持把 Agent 调用链路按 OpenTelemetry Trace 上报到腾讯云 CLS Agent 可观测。

### 本地配置

在 `.env` 中开启并填写腾讯云配置:

```env
AGENT_OBSERVABILITY_ENABLED=true
CLS_DEFAULT_REGION=ap-guangzhou
CLS_TOPIC_ID=8de864a4-99c4-4af8-8695-e9ec8a561893
TENCENTCLOUD_SECRET_ID=your_tencentcloud_secret_id
TENCENTCLOUD_SECRET_KEY=your_tencentcloud_secret_key
SERVICE_NAME=smart-campus-agent
AGENT_TRACE_SAMPLE_RATIO=1
```

`.env` 已被 `.gitignore` 忽略,不要把真实 SecretId / SecretKey 提交到仓库。

### Trace 结构

一次 `/api/agent/stream` 请求会生成一条 `agent.run` 根链路,下挂:

- `agent.memory.load`:加载历史上下文。
- `agent.intent.extract`:JSON Mode 意图/槽位抽取。
- `gen_ai.chat.completions`:调用 OpenAI 兼容接口,记录模型和 token usage。
- `agent.tool.<toolName>`:业务工具调用,如 `get_job_detail`、`recommend_jobs`。

上报字段只包含脱敏后的工程指标:

- `agent.session_id`
- `agent.user_id_hash`
- `agent.context.job_id`
- `agent.prompt.length`
- `agent.prompt.has_job_intent`
- `agent.prompt.has_apply_intent`
- `agent.intent.name`
- `agent.intent.confidence`
- `agent.intent.json_mode_used`
- `agent.tool.name`
- `agent.tool.summary`
- `gen_ai.request.model`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`

不会上报 prompt 原文、简历全文、投递留言、手机号、token 或密钥。

### 验证

1. 启动后端并触发一次 Agent 对话。
2. 进入腾讯云 CLS 控制台,打开对应 trace topic 的检索分析。
3. 查询最新 Trace:

```sql
* | SELECT traceID, spanID, name, duration, statusCode ORDER BY __TIMESTAMP__ DESC LIMIT 10
```

4. 如果要按模型统计平均耗时:

```sql
* | SELECT json_extract_scalar(attribute,'$."gen_ai.request.model"') AS model,
         AVG(duration) AS avg_duration_ns
    GROUP BY model
```

### 聊天室

新聊天室使用独立的 `chat_*` 表，REST 负责持久数据，WebSocket 只负责实时事件：

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/chat/socket-ticket` | 为当前登录用户生成一次性 60 秒连接 ticket |
| GET | `/api/chat/conversations` | 获取会话列表，默认包含校园实时论坛 |
| GET | `/api/chat/conversations/:id/messages` | 游标分页获取历史消息 |
| POST | `/api/chat/conversations/:id/read` | 更新已读位置 |
| WS | `wss://host/chat?ticket=...` | `connection.ready`、`message.send`、`message.accepted`、`message.new` |

浏览器不能在原生 WebSocket 握手中可靠地设置 Authorization header，因此必须先调用
`socket-ticket`，不能把 JWT 放进 WebSocket URL。部署参数和 Nginx Upgrade 配置见
[`docs/chat-deployment.md`](docs/chat-deployment.md)。旧 `/` WebSocket 只保留给岗位浏览人数，
匿名连接不能写入旧聊天消息。

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
