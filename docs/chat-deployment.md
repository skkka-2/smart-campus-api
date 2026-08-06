# Chat deployment

## Recommended first release

Run one API process behind Nginx. The API owns both HTTP and WebSocket on port
`3007`; the browser talks to the public HTTPS origin and uses `wss://` for the
`/chat` connection. Do not expose port `3007` directly to the public network.

```text
browser -- HTTPS / WSS --> Nginx -- HTTP / Upgrade --> smart-campus-api:3007
```

The current implementation is intentionally single-instance:

- `PresenceStore` is an in-memory connection registry;
- the ticket is persisted in MySQL and is one-time, with a 60 second TTL;
- reconnect requests a fresh ticket and then reloads messages through REST;
- messages are durable before `message.accepted` or `message.new` is emitted.

This is enough for one API instance. Do not run multiple API instances until
the in-memory presence store and event broadcast are replaced with Redis-backed
implementations.

## Database migration

From `smart-campus-api` project root, initialize the existing schema and the
chat tables together:

```bash
mysql -u root -p < schema.sql
```

`schema.sql` uses the mysql client `SOURCE` command to load
`docs/chat-data-model.sql`. If your deployment tool does not support `SOURCE`,
run the two files with the second one after `USE item_01`:

```bash
mysql -u root -p item_01 < docs/chat-data-model.sql
```

Do not migrate legacy `message` rows by interpreting `receiver_id = '1'`
without first auditing the actual data. The staging table
`chat_legacy_messages` is provided for rows whose meaning is ambiguous.

## API environment

At minimum, production API `.env` should contain:

```dotenv
NODE_ENV=production
PORT=3007
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=item_01
MYSQL_USER=chat_app
MYSQL_PASSWORD=<strong-password>
JWT_SECRET=<long-random-secret>
CORS_ORIGINS=https://campus.example.com
```

`CORS_ORIGINS` is also used to validate the browser WebSocket `Origin`. It
must contain the exact frontend origin, including scheme and port when a port
is present.

## Nginx

The API and frontend can share one public origin. The important part is that
the `/chat` location uses HTTP/1.1 and forwards the Upgrade headers.

```nginx
server {
    listen 443 ssl;
    server_name campus.example.com;

    # ssl_certificate ...;
    # ssl_certificate_key ...;

    location /api/ {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /chat {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        # ticket 在 query 中只存活 60 秒，避免把它写入反向代理访问日志。
        access_log off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location / {
        root /srv/smart-campus-web/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

The `proxy_pass` values above deliberately keep the `/chat` path unchanged.
The `ws` server routes `/chat` separately from the legacy `/` job-viewer
channel.

## Frontend build

For same-origin production deployment, leave `VITE_BASE_API` empty and set the
WebSocket base to the public secure origin:

```dotenv
VITE_BASE_API=
VITE_WS_URL=wss://campus.example.com
```

The chat composable appends `/chat` and adds the short-lived ticket. It never
puts the JWT in the WebSocket URL. Build after setting production variables:

```bash
npm run build
```

## Process lifecycle

Use systemd, Docker, or a process manager to restart the API. On `SIGTERM` the
API closes chat sockets before closing the HTTP listener, allowing a deploy to
finish cleanly. The browser automatically requests a new ticket and reconnects
after the process is replaced.

## Multi-instance upgrade path

When one process is no longer enough:

1. Implement the existing `PresenceStore` interface with Redis sets and a
   Redis pub/sub channel for `message.new` and `presence.updated`.
2. Publish after the MySQL transaction commits; subscribers deliver to local
   sockets only.
3. Keep ticket consumption in MySQL or move it to Redis with an atomic
   `SET NX PX` operation.
4. Add metrics for active sockets, reconnects, ticket failures, message
   acceptance latency, and publish failures.

Sticky sessions may reduce reconnect churn, but they are not a substitute for
cross-instance event delivery.
