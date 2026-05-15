# F01 Failed to get session 排查报告

## 1. 服务端日志

日志来源：

- `tmp/heyang/lobehub-dev.out.log`
- `tmp/heyang/lobehub-dev.err.log`
- 重启后日志：`tmp/heyang/f01-dev.out.log`、`tmp/heyang/f01-dev.err.log`

最近错误日志关键摘录（已脱敏）：

```text
2026-05-15T00:07:33.928Z ERROR [Better Auth]: INTERNAL_SERVER_ERROR
Error: Failed query:
select ... from "auth_sessions" "session" ... where "session"."token" = $2 limit $3
params: [1, "[redacted-session-token]", 1]

at async betterAuthMiddleware (src\libs\next\proxy\define-config.ts:218:21)

[cause]: Error: connect ECONNREFUSED 127.0.0.1:5432
errno: -4078
code: 'ECONNREFUSED'
syscall: 'connect'
address: '127.0.0.1'
port: 5432

Error [APIError]: Failed to get session
status: 'INTERNAL_SERVER_ERROR'
body: { code: 'FAILED_TO_GET_SESSION', message: 'Failed to get session' }
```

恢复数据库但迁移未完整前，出现过一次 schema mismatch：

```text
ERROR [Better Auth]: INTERNAL_SERVER_ERROR
[cause]: error: column session_users.agent_onboarding does not exist
code: '42703'
```

清 `.next` 并重启后日志：

```text
▲ Next.js 16.2.6 (Turbopack)
- Local:         http://localhost:3010
- Environments: .env
✓ Ready in 1024ms

GET /signin?callbackUrl=http%3A%2F%2Flocalhost%3A3010%2F -> HTTP 200
GET /agent/agt_udqukA8UYJiL -> HTTP 302
```

后续又出现过一次首页 `GET / 500`，关键日志为：

```text
○ Compiling /spa/[variants]/[[...path]] ...
GET / 500
TypeError: fetch failed
cause: ECONNREFUSED
```

排查确认：当时只启动了 Next `3010`，没有启动 SPA/Vite `9876`。项目的 `src/app/spa/[variants]/[[...path]]/route.ts` 会代理到 `http://localhost:9876`，所以必须用 `npm.cmd run dev` 启动完整开发链路，而不是只跑 `next dev -p 3010`。

结论：原始 `Failed to get session` 是 Better Auth 查询 session 时数据库连接失败引起，不是 P01-fix 代码引入。

## 2. docker ps 输出

故障时：

```text
NAMES                IMAGE                STATUS        PORTS
heyu-lobehub-minio   minio/minio:latest   Up 21 hours   0.0.0.0:9000-9001->9000-9001/tcp
```

当时没有 Postgres 容器，服务访问 `127.0.0.1:5432` 被拒绝。

恢复后：

```text
NAMES                IMAGE                           STATUS              PORTS
lobe-postgres        paradedb/paradedb:latest-pg17   Up                  0.0.0.0:5432->5432/tcp
heyu-lobehub-minio   minio/minio:latest              Up                  0.0.0.0:9000-9001->9000-9001/tcp
```

说明：`docker compose -f docker-compose/dev/docker-compose.yml up -d --wait postgresql redis` 首次失败，原因是 `docker-compose/dev/.env` 不存在，compose 中的 `env_file: .env` 按 compose 文件目录解析。

## 3. DB 探活结果

Postgres 恢复过程：

1. 标准 `postgres:17-alpine` 可以启动，但迁移失败，因为缺少 `vector` 扩展。
2. `pgvector/pgvector:pg17` 可以提供 `vector`，但迁移继续失败，因为缺少 `pg_search`。
3. `paradedb/paradedb:latest-pg17` 提供 `vector` 和 `pg_search`，但需要用 `shared_preload_libraries=pg_search` 启动。

最终 DB 探活：

```text
docker exec lobe-postgres pg_isready -U postgres
/var/run/postgresql:5432 - accepting connections

SELECT 1;
1

show shared_preload_libraries;
pg_search

SELECT name FROM pg_available_extensions WHERE name in ('vector','pg_search');
pg_search
vector
```

迁移结果：

```text
npm.cmd run db:migrate
✅ database migration pass. use: 376 ms
```

## 4. session 表状态

项目当前 Better Auth 使用的表是 `auth_sessions`，不是字面量 `"session"` 表。

迁移前：

```text
public.session: missing
public.auth_sessions: missing
```

迁移后：

```text
public.session: missing
public.auth_sessions: exists
auth_sessions_count: 0
```

含义：

- session 表结构已恢复。
- 当前没有登录 session，用户需要重新登录。
- 如果浏览器还带着旧 cookie，建议清理 `localhost:3010` 的站点 cookie 后再登录。

## 5. .env 关键变量清单

只检查存在性，不打印值：

```text
DATABASE_URL=present
AUTH_SECRET=present
KEY_VAULTS_SECRET=present
NEXTAUTH_URL=missing
APP_URL=present
INTERNAL_APP_URL=present
DATABASE_URL.password=missing
```

说明：

- 本地 `DATABASE_URL` 没有密码，因此恢复容器时使用了本地开发用途的 `POSTGRES_HOST_AUTH_METHOD=trust`。
- 正式环境不应使用 trust；正式环境需要给 `DATABASE_URL` 配置密码，并用同一密码启动数据库。
- `NEXTAUTH_URL` 缺失，但当前项目有 `APP_URL` / `INTERNAL_APP_URL`，不是本次 `Failed to get session` 的直接原因。

## 6. 根因结论

归类：a) 数据库连不上。

具体根因链：

1. Next dev 服务运行正常，但 Better Auth 取 session 时需要访问 Postgres。
2. `DATABASE_URL` 指向 `127.0.0.1:5432`。
3. 故障时本机没有 Postgres 容器运行，只有 MinIO。
4. 因此 Better Auth 的 `auth.api.getSession()` 查询失败，抛出 `FAILED_TO_GET_SESSION`。
5. 数据库恢复后，必须使用支持 `vector` 和 `pg_search` 的 ParadeDB 镜像，并加 `shared_preload_libraries=pg_search`，否则迁移不完整。

不是 P01-fix 引入的回归：

- P01-fix 改动范围没有触碰 `src/auth.ts`、Better Auth 配置、数据库 schema、迁移文件或 `.env`。
- 错误栈明确指向 DB 连接和 schema 状态。
- 数据库恢复、迁移完成、清缓存重启后，登录页 HTTP 200，未登录访问 agent 页 HTTP 302，不再 500。

## 7. 用户可以立即执行的恢复步骤

当前我已经完成：

1. 启动 `lobe-postgres` 容器。
2. 使用 `paradedb/paradedb:latest-pg17`。
3. 启动参数带 `-c shared_preload_libraries=pg_search`。
4. 跑通 `npm.cmd run db:migrate`。
5. 删除 `.next` 并用 `npm.cmd run dev` 重启完整 dev 服务。
6. 确认 `3010` 和 `9876` 都在监听。

你现在可以做：

1. 打开 `http://localhost:3010/signin`。
2. 如果仍看到旧的 `Failed to get session` 页面，清理浏览器里 `localhost:3010` 的 cookie 和站点数据。
3. 重新登录。
4. 再访问原来的 `/agent/...` 页面。

本地开发数据库容器如果以后又没了，可以用以下思路恢复：

```text
1. 确认 docker ps 里有 lobe-postgres。
2. 确认 lobe-postgres 镜像是 paradedb/paradedb:latest-pg17。
3. 确认 show shared_preload_libraries; 返回 pg_search。
4. 跑 npm.cmd run db:migrate。
5. 重启 dev 服务。
```
