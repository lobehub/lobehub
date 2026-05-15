# 衡阳本地开发环境启动说明

## 一键检查

```powershell
pnpm heyang:preflight
```

如果 PowerShell 找不到 `pnpm`，使用：

```powershell
corepack.cmd pnpm heyang:preflight
```

preflight 会检查：

- `lobe-postgres` 容器正在运行，镜像为 `paradedb/paradedb:latest-pg17`
- `shared_preload_libraries` 包含 `pg_search`
- MinIO 容器正在运行
- Next 监听 `3010`
- Vite SPA 监听 `9876`
- `auth_sessions` 表存在

## 完整启动方式

必须使用：

```powershell
npm.cmd run dev
```

不要只运行 `next dev -p 3010` 或 `npm.cmd run dev:next`。当前开发模式需要两个前端服务同时存在：

```text
3010  Next
9876  Vite SPA
```

只启动 Next 时，访问 `/` 可能出现 500，服务端日志里会看到 `TypeError: fetch failed` 和 `ECONNREFUSED`。

## 本地依赖端口

```text
3010  Next
9876  Vite SPA
5432  Postgres
9000  MinIO API
9001  MinIO Console
```

## Postgres

本地开发推荐镜像：

```text
paradedb/paradedb:latest-pg17
```

启动时必须包含：

```text
-c shared_preload_libraries=pg_search
```

本地临时启动示例：

```powershell
docker rm -f lobe-postgres
docker run -d --name lobe-postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=lobechat -e POSTGRES_HOST_AUTH_METHOD=trust -p 5432:5432 -v lobe-postgres-data:/var/lib/postgresql/data paradedb/paradedb:latest-pg17 -c shared_preload_libraries=pg_search
npm.cmd run db:migrate
```

`POSTGRES_HOST_AUTH_METHOD=trust` 只允许本机临时开发使用，正式环境必须配置密码。

注：此为技术债 TD-003，见 docs/heyang/TECH-DEBT.md。

## MinIO

本地需要 MinIO 提供对象存储能力。确认容器运行：

```powershell
docker ps
```

看到名称或镜像包含 `minio` 即可。

## 常见错误

更多排查步骤见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。

- `Failed to get session`：优先检查 Postgres 是否运行、迁移是否完成、`auth_sessions` 是否存在。
- 首页 500 且日志有 `ECONNREFUSED 127.0.0.1:9876`：说明没有用 `npm.cmd run dev` 启动完整 dev 栈。
- `pg_search must be loaded via shared_preload_libraries`：重建 `lobe-postgres`，启动参数加 `-c shared_preload_libraries=pg_search`。
