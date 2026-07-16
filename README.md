# smart-campus-api

大学智学网(item01)后端服务。基于 Koa2 + MySQL + JWT + WebSocket + OpenAI。

## 技术栈

- **Node.js** ≥ 18
- **Koa2** —— HTTP 服务
- **mysql2** —— 数据库(MySQL 8.x / 9.x)
- **jsonwebtoken** —— 用户鉴权
- **ws** —— 聊天室 WebSocket
- **openai** —— AI 助手对话(接 chatanywhere 兼容代理)

## 目录结构

```
server/
├── app.js              # 入口:注册中间件、路由、启动 WebSocket
├── db/index.js         # MySQL 连接池
├── middle/checkToken.js # JWT 中间件(白名单 /user/login /user/register)
├── router/             # koa-router 路由定义
│   ├── index.js
│   ├── user.js         # /user/register /user/login
│   └── layout.js       # /mainPart/*
├── router_handler/     # 路由处理函数
│   ├── user.js
│   └── layout.js       # titbang / mid / mid2 / chatRoomHistory / ai / upload ...
├── websocket.js        # 聊天室 WebSocket 服务
├── schema.sql          # 数据库初始化脚本
├── .env.example        # 环境变量模板
└── package.json
```

## 从零到跑起来

### 1. 装依赖

```bash
npm install
```

### 2. 装并启动 MySQL

```bash
brew install mysql
brew services start mysql
mysql_secure_installation   # 设置 root 密码
```

### 3. 初始化数据库

```bash
mysql -u root -p < schema.sql
```
或在可视化工具(Sequel Ace / DBeaver)里粘贴 `schema.sql` 执行。

### 4. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env,填入自己的 MySQL 密码、JWT secret、OpenAI key 等
```

必须填写的字段:
- `MYSQL_PASSWORD` —— 你的 MySQL root 密码
- `JWT_SECRET` —— 任意长随机字符串,签发 JWT 用
- `OPENAI_API_KEY` —— AI 对话接口的密钥(chatanywhere 或 openai 官方)

### 5. 启动

```bash
npm run dev
```

启动成功会看到:
```
[db] Connected to MySQL pool successfully
Server is running on http://localhost:3007
```

## 接口速览

### 用户
| Method | Path | 说明 |
|--------|------|------|
| POST | `/user/register` | 注册,body: `{ username, password, confirmpassword, phone }` |
| POST | `/user/login` | 登录,返回 `{ token, userid }` |

### 首页
| Method | Path | 说明 |
|--------|------|------|
| GET | `/mainPart/titbang` | 首页右侧三个榜单 |
| GET | `/mainPart/mid?page=1&limit=5` | "推荐" tab 分页 |
| GET | `/mainPart/mid2?page=1&limit=5` | "最新" tab 分页 |
| POST | `/mainPart/upload` | 上传文章 |

### AI 助手
| Method | Path | 说明 |
|--------|------|------|
| POST | `/mainPart/ai` | 向 AI 提问,body: `{ content, userID }` |
| POST | `/mainPart/getChatHistory` | 拉取用户历史对话 |
| POST | `/mainPart/clearChatHistory` | 清空对话 |

### 聊天室
| Method | Path | 说明 |
|--------|------|------|
| GET | `/mainPart/chatRoomHistory` | 拉取最新 10 条聊天记录 |
| WS | `ws://host:3007?userId=xxx` | WebSocket 长连,发消息见 `websocket.js` |

## 关联仓库

- 前端:https://github.com/skkka-2/smart-campus-web
