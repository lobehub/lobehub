# 本地运行 E2E 测试

## 前置要求

- Docker Desktop 已安装并**正在运行**
- Node.js 18+
- pnpm 已安装
- 项目已 `pnpm install`

## 完整启动流程

### Step 0: 环境清理（重要！）

每次运行测试前，建议先清理环境，避免残留状态导致问题。

```bash
# 0.1 确保 Docker Desktop 正在运行
# 如果未运行，请先启动 Docker Desktop

# 0.2 清理旧的 PostgreSQL 容器
docker stop postgres-e2e 2> /dev/null
docker rm postgres-e2e 2> /dev/null

# 0.3 清理占用的端口
lsof -ti:3006 | xargs kill -9 2> /dev/null # Next.js 服务器端口
lsof -ti:5433 | xargs kill -9 2> /dev/null # PostgreSQL 端口
```

### Step 1: 启动数据库

```bash
# 启动 PostgreSQL (端口 5433)
docker run -d --name postgres-e2e \
  -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 \
  paradedb/paradedb:latest

# 等待数据库就绪
until docker exec postgres-e2e pg_isready; do sleep 2; done
echo "PostgreSQL is ready!"
```

### Step 2: 运行数据库迁移

```bash
# 在项目根目录运行
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  DATABASE_DRIVER=node \
  bun run db:migrate
```

### Step 3: 构建应用（首次或代码变更后）

```bash
# 在项目根目录运行
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  DATABASE_DRIVER=node \
  KEY_VAULTS_SECRET=LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s= \
  BETTER_AUTH_SECRET=e2e-test-secret-key-for-better-auth-32chars! \
  NEXT_PUBLIC_ENABLE_BETTER_AUTH=1 \
  SKIP_LINT=1 \
  bun run build
```

### Step 4: 启动应用服务器

**重要**: 必须在**项目根目录**运行，不能在 e2e 目录运行！

```bash
# 在项目根目录运行（注意：不是 e2e 目录）
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

### Step 5: 等待服务器就绪

```bash
# 在另一个终端运行，确认服务器已启动
until curl -s http://localhost:3006 > /dev/null; do
  sleep 2
  echo "Waiting..."
done
echo "Server is ready!"
```

### Step 6: 运行测试

```bash
# 在 e2e 目录运行测试
cd e2e

# 运行特定标签（默认无头模式）
BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@conversation"

# 运行所有测试
BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js

# 调试模式（显示浏览器，观察执行过程）
HEADLESS=false \
  BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@conversation"
```

## 一键启动脚本

### 完整初始化（首次运行或需要重建）

在项目根目录创建 `e2e-init.sh`：

```bash
#!/bin/bash
set -e

echo "🧹 Step 0: Cleaning up..."
docker stop postgres-e2e 2> /dev/null || true
docker rm postgres-e2e 2> /dev/null || true
lsof -ti:3006 | xargs kill -9 2> /dev/null || true
lsof -ti:5433 | xargs kill -9 2> /dev/null || true

echo "🐘 Step 1: Starting PostgreSQL..."
docker run -d --name postgres-e2e \
  -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 \
  paradedb/paradedb:latest

echo "⏳ Waiting for PostgreSQL..."
until docker exec postgres-e2e pg_isready 2> /dev/null; do sleep 2; done
echo "✅ PostgreSQL is ready!"

echo "🔄 Step 2: Running migrations..."
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  DATABASE_DRIVER=node \
  bun run db:migrate

echo "🔨 Step 3: Building application..."
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  DATABASE_DRIVER=node \
  KEY_VAULTS_SECRET=LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s= \
  BETTER_AUTH_SECRET=e2e-test-secret-key-for-better-auth-32chars! \
  NEXT_PUBLIC_ENABLE_BETTER_AUTH=1 \
  SKIP_LINT=1 \
  bun run build

echo "✅ Initialization complete! Now run e2e-start.sh to start the server."
```

### 快速启动服务器

在项目根目录创建 `e2e-start.sh`：

```bash
#!/bin/bash
set -e

echo "🧹 Cleaning up ports..."
lsof -ti:3006 | xargs kill -9 2> /dev/null || true

echo "🚀 Starting Next.js server on port 3006..."
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

### 运行测试

在 e2e 目录创建 `run-test.sh`：

```bash
#!/bin/bash

# 默认参数
TAGS="${1:-@journey}"
HEADLESS="${HEADLESS:-true}" # 默认无头模式

echo "🧪 Running E2E tests with tags: $TAGS"
echo "   Headless: $HEADLESS"

HEADLESS=$HEADLESS \
  BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "$TAGS"
```

使用方式：

```bash
# 运行特定标签（默认无头模式）
./run-test.sh "@conversation"

# 调试模式（显示浏览器）
HEADLESS=false ./run-test.sh "@conversation"
```

## 快速启动（假设数据库和构建已完成）

```bash
# Terminal 1: 启动服务器（项目根目录）
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

# Terminal 2: 运行测试（e2e 目录，默认无头模式）
cd e2e
BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@conversation"

# 调试模式（显示浏览器）
HEADLESS=false BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@conversation"
```

## 环境变量参考

### 测试运行时环境变量

| 变量           | 值                                                       | 说明                                                |
| -------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `BASE_URL`     | `http://localhost:3006`                                  | 测试服务器地址                                      |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/postgres` | 数据库连接                                          |
| `HEADLESS`     | `true`(默认)/`false`                                     | 是否无头模式运行浏览器，设为 `false` 可观察执行过程 |

### 服务器启动环境变量（全部必需）

| 变量                                  | 值                                                       | 说明             |
| ------------------------------------- | -------------------------------------------------------- | ---------------- |
| `DATABASE_URL`                        | `postgresql://postgres:postgres@localhost:5433/postgres` | 数据库连接       |
| `DATABASE_DRIVER`                     | `node`                                                   | 数据库驱动       |
| `KEY_VAULTS_SECRET`                   | `LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s=`           | 密钥保险库密钥   |
| `BETTER_AUTH_SECRET`                  | `e2e-test-secret-key-for-better-auth-32chars!`           | 认证密钥         |
| `NEXT_PUBLIC_ENABLE_BETTER_AUTH`      | `1`                                                      | 启用 Better Auth |
| `NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION` | `0`                                                      | 禁用邮箱验证     |

### S3 Mock 变量（必需！）

| 变量                   | 值                              |
| ---------------------- | ------------------------------- |
| `S3_ACCESS_KEY_ID`     | `e2e-mock-access-key`           |
| `S3_SECRET_ACCESS_KEY` | `e2e-mock-secret-key`           |
| `S3_BUCKET`            | `e2e-mock-bucket`               |
| `S3_ENDPOINT`          | `https://e2e-mock-s3.localhost` |

**注意**: S3 环境变量是**必需**的，即使不测试文件上传功能。缺少这些变量会导致发送消息时报错 "S3 environment variables are not set completely"。

## 常见问题排查

### Docker daemon is not running

**症状**: `Cannot connect to the Docker daemon`

**解决**: 启动 Docker Desktop 应用

### PostgreSQL 容器已存在

**症状**: `docker: Error response from daemon: Conflict. The container name "/postgres-e2e" is already in use`

**解决**:

```bash
docker stop postgres-e2e
docker rm postgres-e2e
```

### S3 environment variables are not set completely

**原因**: 服务器启动时缺少 S3 环境变量

**解决**: 启动服务器时必须设置所有 S3 mock 变量

### Cannot find module './src/libs/next/config/define-config'

**原因**: 在 e2e 目录下运行 `next start`

**解决**: 必须在**项目根目录**运行 `bunx next start`，不能在 e2e 目录运行

### EADDRINUSE: address already in use

**原因**: 端口被占用

**解决**:

```bash
# 查找并杀掉占用端口的进程
lsof -ti:3006 | xargs kill -9
lsof -ti:5433 | xargs kill -9
```

### BeforeAll hook errored: net::ERR_CONNECTION_REFUSED

**原因**: 服务器未启动或未就绪

**解决**:

1. 确认服务器已启动：`curl http://localhost:3006`
2. 确认 `BASE_URL` 环境变量设置正确
3. 等待服务器完全就绪后再运行测试

### 测试超时或不稳定

**可能原因**:

1. 网络延迟
2. 服务器响应慢
3. 元素定位问题

**解决**:

1. 使用 `HEADLESS=false` 观察测试执行过程
2. 检查 `screenshots/` 目录中的失败截图
3. 增加等待时间或使用更稳定的定位器

## 清理环境

测试完成后，清理环境：

```bash
# 停止服务器
lsof -ti:3006 | xargs kill -9

# 停止并删除 PostgreSQL 容器
docker stop postgres-e2e
docker rm postgres-e2e
```
