# 企业化改造本地故障排查

## 先跑 preflight

遇到本地页面 500、登录失败、`Failed to get session` 或首页空白，先运行：

```powershell
pnpm heyang:preflight
```

它会一次性检查 Postgres、`pg_search`、MinIO、Next `3010`、Vite SPA `9876` 和 `auth_sessions` 表，并给出对应修复命令。

## Failed to get session

现象：

```text
Runtime APIError: Failed to get session
Better Auth: connect ECONNREFUSED 127.0.0.1:5432
```

优先判断为本地数据库没起来，而不是聊天或模型调用代码问题。

检查顺序：

```powershell
docker ps
docker exec lobe-postgres pg_isready -U postgres
```

本项目本地数据库需要支持：

```text
vector
pg_search
```

推荐本地开发容器：

```text
paradedb/paradedb:latest-pg17
```

启动时必须让 `pg_search` 进入 `shared_preload_libraries`，否则 `npm.cmd run db:migrate` 会失败：

```text
pg_search must be loaded via shared_preload_libraries
```

恢复步骤：

```powershell
npm.cmd run db:migrate
Remove-Item .next -Recurse -Force
npm.cmd run dev
```

不要只运行 `next dev -p 3010`。LobeHub 当前开发模式还需要 Vite SPA 服务：

```text
Next: http://localhost:3010
Vite SPA: http://localhost:9876
```

如果只启动 Next，访问首页可能出现：

```text
GET / 500
TypeError: fetch failed
ECONNREFUSED
```

原因是 `src/app/spa/[variants]/[[...path]]/route.ts` 会请求 `http://localhost:9876`。

如果 `auth_sessions` 表存在但 count 为 0，这是正常的空登录态。用户需要重新登录；如果浏览器仍然报旧 session 错误，清理 `localhost:3010` 的 cookie 和站点数据。

注意：

- 本地 `DATABASE_URL` 如果没有密码，可以只在本机临时用 `POSTGRES_HOST_AUTH_METHOD=trust`。
- 正式环境必须使用密码，不要使用 trust。
- 不要通过重置数据库来解决 session 问题，除非已经确认没有需要保留的数据。
