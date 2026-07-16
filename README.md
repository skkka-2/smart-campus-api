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

## 目录结构

```
smart-campus-api/
├── src/
│   ├── app.js                # 入口:装配中间件 + 路由 + WS
│   ├── config/               # 环境变量、常量
│   ├── db/                   # MySQL 连接池
│   ├── middleware/           # error / auth / logger / cors
│   ├── routes/               # koa-router 组装(index / user / article / comment / ai / chat)
│   ├── controllers/          # HTTP I/O 层
│   ├── services/             # 业务逻辑
│   ├── repositories/         # SQL 查询(一表一文件)
│   ├── utils/                # response 包装、jwt 工具、分页
│   └── websocket/            # WebSocket handler
├── schema.sql                # 数据库初始化 + 种子数据
├── .env.example              # 环境变量模板
├── package.json
└── README.md
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
- `JWT_SECRET` —— 一段长随机字符串
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
- **routes/** 只做 URL → controller 绑定,per-route 挂 `requireAuth`
- **controllers/** 只做 HTTP 层(读 req、调 service、`ctx.success/fail`),不写业务
- **services/** 写业务逻辑,抛 `BizError`(见 `utils/response.js`)
- **repositories/** 只写 SQL,不感知 HTTP

**统一响应格式**:
```json
{ "code": 0, "message": "ok", "data": {...} }
```
- `code: 0` = 成功;非 0 为业务错误码
- HTTP 状态码正常使用(200 / 400 / 401 / 404 / 500)
- 前端只需检查 `res.data.code === 0`

**鉴权**:per-route 中间件 `requireAuth`,公共接口(注册、登录、文章列表、榜单)无需 token。

**错误处理**:controller 里不写 try/catch,直接抛 `BizError`(或让异常冒泡),全局 error middleware 兜住并返回规范格式。

## 接口速览

### 用户
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| POST | `/api/users/register` | ✗ | body: `{ username, password, phone }` |
| POST | `/api/users/login` | ✗ | body: `{ username, password }` → `{ token, user }` |
| GET  | `/api/users/me` | ✓ | 当前登录用户 |

### 文章
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| GET  | `/api/articles?sort=recommend\|latest&page=1&limit=5` | ✗ | 分页信息流 |
| GET  | `/api/articles/rankings` | ✗ | 首页右侧三榜(articles/authors/topics)|
| POST | `/api/articles` | ✓ | body: `{ content }` |

### 评论
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| GET  | `/api/comments?page=1&limit=20` | ✗ | 分页 |
| POST | `/api/comments/query` | ✗ | body: `{ userName }`(兼容旧接口) |
| POST | `/api/comments` | ✓ | body: `{ content }` |

### AI 助手
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| POST   | `/api/ai/chat` | ✓ | body: `{ content }` |
| GET    | `/api/ai/history` | ✓ | 拉取当前用户历史对话 |
| DELETE | `/api/ai/history` | ✓ | 清空当前用户对话 |

### 聊天室(WebSocket)
| Method | Path | Auth | 说明 |
|--------|------|:----:|------|
| GET | `/api/chat/history?limit=10` | ✗ | 最新 N 条群聊 |
| WS  | `ws://host:3007/?userId=xxx&token=xxx` | 可选 | 长连接,消息格式 `{ senderId, receiverIds, content }` |

### 其它
| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/health` | 存活检查 |

## 开发

```bash
npm run dev      # nodemon 热重载
npm start        # 直接 node
```

## 关联仓库

- 前端:https://github.com/skkka-2/smart-campus-web
