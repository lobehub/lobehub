# 本地运行 E2E 测试

## 前置要求

- Docker Desktop 已安装并**正在运行**
- Node.js 18+
- pnpm 已安装
- 项目已 `pnpm install`

## 一键启动（推荐）

使用 TypeScript 脚本自动完成环境设置：

```bash
# 在项目根目录运行

# 仅设置数据库（启动 PostgreSQL + 运行迁移）
bun e2e/scripts/setup.ts

# 设置数据库并启动服务器
bun e2e/scripts/setup.ts --start

# 完整设置（数据库 + 构建 + 启动服务器）
bun e2e/scripts/setup.ts --build --start

# 清理环境
bun e2e/scripts/setup.ts --clean
```

### 脚本选项

| 选项             | 说明                         |
| ---------------- | ---------------------------- |
| `--clean`        | 清理现有容器和进程           |
| `--skip-db`      | 跳过数据库设置（使用已有的） |
| `--skip-migrate` | 跳过数据库迁移               |
| `--build`        | 启动前构建应用               |
| `--start`        | 设置完成后启动服务器         |
| `--port <port>`  | 服务器端口（默认 3006）      |
| `--help`         | 显示帮助信息                 |

## 运行测试

```bash
cd e2e

# 运行所有测试
BASE_URL=http://localhost:3006 bun run test

# 运行特定标签
BASE_URL=http://localhost:3006 bun run test -- --tags "@conversation"

# 调试模式（显示浏览器）
HEADLESS=false BASE_URL=http://localhost:3006 bun run test -- --tags "@smoke"
```

## 手动启动流程

如果需要手动控制各个步骤，可以按照以下流程操作：

### Step 1: 环境清理

```bash
# 清理旧的 PostgreSQL 容器
docker stop postgres-e2e 2> /dev/null
docker rm postgres-e2e 2> /dev/null

# 清理占用的端口
lsof -ti:3006 | xargs kill -9 2> /dev/null
lsof -ti:5433 | xargs kill -9 2> /dev/null
```

### Step 2: 启动数据库

```bash
# 启动 PostgreSQL (端口 5433)
docker run -d --name postgres-e2e \
  -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 \
  paradedb/paradedb:latest

# 等待数据库就绪
until docker exec postgres-e2e pg_isready; do sleep 2; done
```

### Step 3: 运行数据库迁移

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  DATABASE_DRIVER=node \
  KEY_VAULTS_SECRET=LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s= \
  bun run db:migrate
```

### Step 4: 构建应用（首次或代码变更后）

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  DATABASE_DRIVER=node \
  KEY_VAULTS_SECRET=LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s= \
  BETTER_AUTH_SECRET=e2e-test-secret-key-for-better-auth-32chars! \
  NEXT_PUBLIC_ENABLE_BETTER_AUTH=1 \
  SKIP_LINT=1 \
  bun run build
```

### Step 5: 启动应用服务器

**重要**: 必须在**项目根目录**运行！

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  DATABASE_DRIVER=node \
  KEY_VAULTS_SECRET=LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s= \
  BETTER_AUTH_SECRET=e2e-test-secret-key-for-better-auth-32chars! \
  NEXT_PUBLIC_ENABLE_BETTER_AUTH=1 \
  NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION=0 \
  S3_ACCESS_KEY_ID=e2e-mock-access-key \
  S3_SECRET_ACCESS_KEY=e2e-mock-secret-key \
  S3_BUCKET=e2e-mock-bucket \
  S3_ENDPOINT=https://e2e-mock-s3.localhost \
  bunx next start -p 3006
```

## 环境变量参考

### 服务器启动环境变量

| 变量                                  | 值                                                       | 说明             |
| ------------------------------------- | -------------------------------------------------------- | ---------------- |
| `DATABASE_URL`                        | `postgresql://postgres:postgres@localhost:5433/postgres` | 数据库连接       |
| `DATABASE_DRIVER`                     | `node`                                                   | 数据库驱动       |
| `KEY_VAULTS_SECRET`                   | `LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s=`           | 密钥保险库密钥   |
| `BETTER_AUTH_SECRET`                  | `e2e-test-secret-key-for-better-auth-32chars!`           | 认证密钥         |
| `NEXT_PUBLIC_ENABLE_BETTER_AUTH`      | `1`                                                      | 启用 Better Auth |
| `NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION` | `0`                                                      | 禁用邮箱验证     |

### S3 Mock 变量（必需）

| 变量                   | 值                              |
| ---------------------- | ------------------------------- |
| `S3_ACCESS_KEY_ID`     | `e2e-mock-access-key`           |
| `S3_SECRET_ACCESS_KEY` | `e2e-mock-secret-key`           |
| `S3_BUCKET`            | `e2e-mock-bucket`               |
| `S3_ENDPOINT`          | `https://e2e-mock-s3.localhost` |

### 测试运行时环境变量

| 变量           | 值                                                       | 说明                   |
| -------------- | -------------------------------------------------------- | ---------------------- |
| `BASE_URL`     | `http://localhost:3006`                                  | 测试服务器地址         |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/postgres` | 数据库连接             |
| `HEADLESS`     | `true`(默认)/`false`                                     | 是否显示浏览器执行过程 |

## 常见问题

### Docker daemon is not running

**症状**: `Cannot connect to the Docker daemon`

**解决**: 启动 Docker Desktop 应用

### PostgreSQL 容器已存在

**症状**: `The container name "/postgres-e2e" is already in use`

**解决**: `bun e2e/scripts/setup.ts --clean` 或手动执行：

```bash
docker stop postgres-e2e && docker rm postgres-e2e
```

### S3 environment variables are not set completely

**原因**: 服务器启动时缺少 S3 环境变量

**解决**: 使用 `bun e2e/scripts/setup.ts --start` 或确保手动设置所有 S3 mock 变量

### Cannot find module './src/libs/next/config/define-config'

**原因**: 在 e2e 目录下运行 `next start`

**解决**: 必须在**项目根目录**运行服务器

### EADDRINUSE: address already in use

**原因**: 端口被占用

**解决**: `bun e2e/scripts/setup.ts --clean` 或：

```bash
lsof -ti:3006 | xargs kill -9
```

### BeforeAll hook errored: net::ERR_CONNECTION_REFUSED

**原因**: 服务器未启动或未就绪

**解决**:

1. 确认服务器已启动：`curl http://localhost:3006`
2. 确认 `BASE_URL` 环境变量设置正确
