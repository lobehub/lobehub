# LuGod AI

> 基于 [LobeHub](https://github.com/lobehub/lobehub) 二次开发的个人 AI 助手工作台，品牌已定制为 **LuGod AI**。
> A customized fork of [LobeHub](https://github.com/lobehub/lobehub), rebranded as **LuGod AI**.

[中文](#中文) | [English](#english)

---

## 中文

### 项目介绍

本仓库是 [Lugod01/lobehub](https://github.com/Lugod01/lobehub)（`canary` 分支，版本 2.3.3），以上游 LobeHub 为基座，做了品牌与视觉层的定制，同时在本地跑通了完整开发环境（Next.js 主站 + Vite 前端 + PostgreSQL + Redis）。

与上游的差别只有以下几处，业务逻辑、模型接入、插件体系均保持上游原样：

| 定制项 | 位置 | 说明 |
| --- | --- | --- |
| 应用名称 `LuGod AI` | [branding.ts](packages/business/const/src/branding.ts) | `BRANDING_NAME`，驱动浏览器标题、登录页文案、PWA 图标、页脚水印 |
| 自有 Logo | [public/branding/lugod-ai.png](public/branding/lugod-ai.png) | `BRANDING_LOGO_URL`，512×512，侧边栏 / 登录页 / 启动闪屏共用 |
| 深紫主题 | [purple-theme.css](src/styles/purple-theme.css) | 覆盖 `@lobehub/ui` 的 `--lobe-color-*` 变量，底色 `#150b2e`，主色 `#8b5cf6` |
| 首页「快速开始」卡片 | [QuickStartCard.tsx](src/features/Home/QuickStartCard.tsx) | 输入框上方三步引导：选择 AI 模型 → 输入问题 → 获取回答 |
| 首页标语 | [locales/zh-CN/home.json](locales/zh-CN/home.json) | 问候语统一为「你的专属AI助手」 |

> 上游原始 README 已保留在 [README.upstream.md](README.upstream.md)，其中包含完整的部署、Docker、桌面端、插件开发等官方文档。

### 功能列表

保留上游全部能力：

- **多模型对话**：OpenAI / Azure OpenAI / Anthropic / Google / 本地 Ollama 等，通过统一的 Provider 体系接入
- **AI Agent**：自建助手、插件调用、多轮工具链、Agent 市场
- **知识库与文件**：文档上传、RAG 检索、图片理解
- **插件 / MCP**：Function Call 与 MCP 工具接入
- **多端**：Web、桌面端（Electron）、移动端、Share 分享页、Workbench
- **账号体系**：邮箱密码注册登录（better-auth），支持 SSO、邮件验证开关
- **中文优先**：默认简体中文界面，语言包位于 `locales/`

本次定制带来的界面变化：

- 全局深紫深色配色（含登录页、侧边栏、聊天区、滚动条）
- 品牌名与 Logo 全站一致为 LuGod AI
- 首页聊天输入区上方新增三步骤「快速开始」引导卡片，窄屏自动叠为单列

### 环境要求

| 组件 | 版本 | 备注 |
| --- | --- | --- |
| Node.js | 22+（本机实测 26.13.0） | 建议用 `node -v` 确认 |
| pnpm | 12.4.1 | 由 `package.json` 的 `packageManager` 固定 |
| PostgreSQL | 17 | 需 `pgvector`、`pg_search`，推荐 `paradedb/paradedb:latest-pg17` |
| Redis | 7 | 缓存与会话 |
| Docker Desktop | 任意较新版本 | 仅用于起 PostgreSQL / Redis |

### 安装步骤

#### 1. 克隆仓库

```bash
git clone https://github.com/Lugod01/lobehub.git
cd lobehub
git checkout canary
```

#### 2. 安装依赖

```bash
pnpm install --ignore-scripts
```

必须带 `--ignore-scripts`。原因有两个，都是上游脚本在 Windows 上的已知问题：

- `ffmpeg-static`、`workerd` 的 postinstall 会从 GitHub Releases 下载二进制，国内网络容易卡死；跳过脚本后二进制若缺失，可单独执行 `node node_modules/ffmpeg-static/install.js`
- `prepare` 脚本含 Linux shell 语法（`> /dev/null`），在 Windows 上必然报错

注意：仓库根目录**没有** `pnpm-lock.yaml`（上游只跟踪 `apps/desktop/pnpm-lock.yaml`），且 `pnpm-workspace.yaml` 中 `lockfile: false`、`resolutionMode: highest`，每次安装解析出的次版本可能不同，属预期行为。

#### 3. 启动数据库

本机实际使用独立容器，刻意避开 5432 / 6379，避免与其它环境冲突：

```bash
docker run -d --name lobehub2-postgres \
  -e POSTGRES_PASSWORD=your-password \
  -e POSTGRES_DB=lobechat_dev2 \
  -p 5433:5432 paradedb/paradedb:latest-pg17

docker run -d --name lobehub2-redis -p 6380:6379 redis:7-alpine
```

也可以直接用仓库自带编排（会占用 5432 / 6379）：

```bash
pnpm dev:docker        # postgresql + redis + rustfs + searxng
pnpm dev:docker:down   # 停止
```

#### 4. 配置环境变量

新建 `.env.development.local`（该文件已被 `.gitignore` 忽略，不会进版本库）：

```dotenv
APP_URL=http://localhost:3011

DATABASE_URL=postgresql://postgres:your-password@localhost:5433/lobechat_dev2
DATABASE_DRIVER=node

REDIS_URL=redis://localhost:6380
REDIS_PREFIX=lobechat
REDIS_TLS=0

# 32 字节随机串（base64），用于加密存储的密钥
KEY_VAULTS_SECRET=<随机串>
AUTH_SECRET=<随机串>

# 本地开发常需要访问内网服务，放开 SSRF 限制
SSRF_ALLOW_PRIVATE_IP_ADDRESS=1
LLM_VISION_IMAGE_USE_BASE64=1
```

生成随机串（PowerShell）：

```powershell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

#### 5. 执行数据库迁移

```bash
pnpm db:migrate
```

该脚本自带 `MIGRATION_DB=1`，会按 `DATABASE_URL` 建表（约 240 张表）并安装 `pg_search` / `vector` / `pg_ivm` 等扩展。

#### 6. 启动

```bash
# 默认 3010（Next）+ 9876（Vite）
pnpm dev

# 需要换端口时（本机实际用法）
PORT=3011 SPA_PORT=9877 pnpm dev
```

`pnpm dev` 会并行启动 `next dev` 与 `vite`，两者端口分别取 `PORT` / `SPA_PORT`，被占用时自动顺延。**注意：上游脚本内部调用 `bunx`，若本机 `bun` 是坏的占位程序，需要先安装可用的 Bun，或手动分别执行 `npx next dev -p 3011` 与 `npx vite --port 9877`。**

### 使用说明

#### 访问

| 地址 | 用途 |
| --- | --- |
| http://localhost:3011 | 主站（Next.js） |
| http://localhost:9877 | 前端静态资源（Vite，随主站自动加载，无需单独打开） |

#### 注册与登录

首次打开会跳转 `/signin`。邮箱密码注册默认开启（`AUTH_DISABLE_EMAIL_PASSWORD` 未设置即为启用），注册后直接可用，无需邮箱验证。若要关闭注册，在环境变量里设 `AUTH_DISABLE_EMAIL_PASSWORD=1`。

#### 开始聊天

1. 进入首页，输入区上方可见「快速开始」卡片：选择 AI 模型 / 输入问题 / 获取回答
2. 在设置里填入模型服务商的 API Key（OpenAI、Anthropic、DeepSeek 等任选其一）
3. 回到首页，选择模型后直接在输入框提问即可；不配 Key 也能正常打开界面，只是无法真正对话

#### 桌面一键启停（Windows，可选）

`%LOCALAPPDATA%\LobeHubDev2\` 下提供了静默启停脚本，桌面已放置对应的 bat：

| 文件 | 作用 |
| --- | --- |
| `启动LobeHub-Fork.bat` | 启动 PostgreSQL 5433、Redis 6380，后台拉起 Next 3011 与 Vite 9877，不额外弹命令行窗口 |
| `停止LobeHub-Fork.bat` | 结束端口占用进程与隐藏包装进程，停止两个容器，释放全部端口 |

重复双击启动是幂等的（已在运行则跳过，PID 不变）。运行日志位于 `%LOCALAPPDATA%\LobeHubDev2\logs\dev.log`。

#### 常见问题

| 现象 | 处理 |
| --- | --- |
| `pnpm install` 长时间无响应 | 多为 `ffmpeg-static` / `workerd` 在拉 GitHub 二进制，Ctrl+C 后用 `--ignore-scripts` 重装 |
| 页面全白、控制台无报错 | 开发服务器重启后浏览器缓存了旧模块图，`Ctrl+Shift+R` 或换无痕窗口 |
| 迁移报扩展缺失 | 确认用的是 `paradedb` 镜像，而不是官方 `postgres` 镜像 |
| 端口被占用 | Next / Vite 会自动顺延端口，以日志里打印的实际端口为准 |
| 登录页 404 或样式缺失 | 确认 Vite（9877）已启动，主站依赖它提供 SPA 资源 |

### 与上游同步

```bash
git remote add upstream https://github.com/lobehub/lobehub.git
git fetch upstream
git merge upstream/canary
```

定制集中在品牌常量、主题 CSS、首页组件与语言包，冲突面很小。

---

## English

### Overview

This repository is a personal fork of [LobeHub](https://github.com/lobehub/lobehub) (`canary` branch, version 2.3.3), rebranded as **LuGod AI**. Only branding and visual layers are customized; the agent framework, provider adapters and plugin system stay identical to upstream.

| Customization | Location | Notes |
| --- | --- | --- |
| App name `LuGod AI` | [branding.ts](packages/business/const/src/branding.ts) | `BRANDING_NAME`, drives page title, auth copy, PWA icons, footer watermark |
| Custom logo | [public/branding/lugod-ai.png](public/branding/lugod-ai.png) | `BRANDING_LOGO_URL`, 512×512, shared by sidebar, auth pages and boot shell |
| Deep purple theme | [purple-theme.css](src/styles/purple-theme.css) | Overrides `@lobehub/ui` `--lobe-color-*` tokens; base `#150b2e`, primary `#8b5cf6` |
| Quick start card | [QuickStartCard.tsx](src/features/Home/QuickStartCard.tsx) | Three-step guide above the home input: choose a model, ask a question, get an answer |
| Home headline | [locales/zh-CN/home.json](locales/zh-CN/home.json) | Greeting replaced with 「你的专属AI助手」 |

The upstream documentation is preserved in [README.upstream.md](README.upstream.md) (deployment, Docker, desktop app, plugin development).

### Features

Everything from upstream is retained:

- Multi-provider chat: OpenAI, Azure OpenAI, Anthropic, Google, local Ollama, and more
- AI agents with tool calling, plugin ecosystem and agent marketplace
- Knowledge base, document upload, RAG retrieval and vision input
- Function Call and MCP tool integration
- Multi-platform: Web, Electron desktop, mobile, share pages, workbench
- Email/password auth via better-auth, optional SSO and email verification
- Localized UI (Simplified Chinese by default)

Fork-specific UI differences: a global dark purple palette (auth pages, sidebar, chat area, scrollbars), consistent LuGod AI branding, and the new three-step quick start card on the home screen.

### Requirements

| Component | Version | Notes |
| --- | --- | --- |
| Node.js | 22+ (verified on 26.13.0) | Check with `node -v` |
| pnpm | 12.4.1 | Pinned by `packageManager` |
| PostgreSQL | 17 | Requires `pgvector` and `pg_search`; `paradedb/paradedb:latest-pg17` recommended |
| Redis | 7 | Cache and sessions |
| Docker Desktop | Recent version | Only to run PostgreSQL / Redis |

### Installation

```bash
git clone https://github.com/Lugod01/lobehub.git
cd lobehub
git checkout canary

# Install dependencies (postinstall must be skipped, see note below)
pnpm install --ignore-scripts
```

`--ignore-scripts` is required on Windows: `ffmpeg-static` and `workerd` postinstall steps download binaries from GitHub Releases (often stalls behind the GFW), and the `prepare` script uses Linux shell syntax (`> /dev/null`) which fails on Windows. If the ffmpeg binary is missing afterwards, run `node node_modules/ffmpeg-static/install.js`.

There is no root `pnpm-lock.yaml` upstream (only `apps/desktop/pnpm-lock.yaml` is tracked) and the workspace config sets `lockfile: false` with `resolutionMode: highest`, so minor versions may differ between installs. That is expected.

Start the databases (deliberately mapped to 5433 / 6380 to avoid conflicts):

```bash
docker run -d --name lobehub2-postgres \
  -e POSTGRES_PASSWORD=your-password \
  -e POSTGRES_DB=lobechat_dev2 \
  -p 5433:5432 paradedb/paradedb:latest-pg17

docker run -d --name lobehub2-redis -p 6380:6379 redis:7-alpine

# or use the bundled compose file (binds 5432 / 6379)
pnpm dev:docker
```

Create `.env.development.local` (git-ignored):

```dotenv
APP_URL=http://localhost:3011

DATABASE_URL=postgresql://postgres:your-password@localhost:5433/lobechat_dev2
DATABASE_DRIVER=node

REDIS_URL=redis://localhost:6380
REDIS_PREFIX=lobechat
REDIS_TLS=0

KEY_VAULTS_SECRET=<32-byte random, base64>
AUTH_SECRET=<32-byte random, base64>

SSRF_ALLOW_PRIVATE_IP_ADDRESS=1
LLM_VISION_IMAGE_USE_BASE64=1
```

Then migrate and start:

```bash
pnpm db:migrate      # creates ~240 tables plus required extensions
pnpm dev             # Next 3010 + Vite 9876 by default

# custom ports (what this machine uses)
PORT=3011 SPA_PORT=9877 pnpm dev
```

`pnpm dev` spawns `next dev` and `vite` in parallel, honoring `PORT` and `SPA_PORT` (auto-incrementing when busy). Note that upstream wires these through `bunx`; if `bun` on your machine is a broken stub, install a working Bun or run `npx next dev -p 3011` and `npx vite --port 9877` manually.

### Usage

| URL | Purpose |
| --- | --- |
| http://localhost:3011 | Main application (Next.js) |
| http://localhost:9877 | Frontend assets (Vite, loaded automatically by the main app) |

Open the site, sign up with any email and password (email/password auth is enabled by default; there is no email verification unless `AUTH_EMAIL_VERIFICATION` is set). On the home screen you will see the quick start card above the input: choose a model, ask a question, get an answer. Add a provider API key in settings to actually chat — the UI loads fine without one.

On Windows, `启动LobeHub-Fork.bat` and `停止LobeHub-Fork.bat` on the desktop start and stop the whole stack silently (services run in the background, no extra console windows, idempotent restarts). Logs: `%LOCALAPPDATA%\LobeHubDev2\logs\dev.log`.

Troubleshooting:

| Symptom | Fix |
| --- | --- |
| `pnpm install` hangs | Usually `ffmpeg-static` / `workerd` downloading from GitHub; abort and reinstall with `--ignore-scripts` |
| Blank page with clean console | Browser cached the previous module graph; hard reload with `Ctrl+Shift+R` or use a private window |
| Migration complains about missing extensions | Make sure you run the `paradedb` image, not plain `postgres` |
| Login page 404 or unstyled | Vite (9877) is not running; the main app serves SPA assets from it |

### Staying in sync

```bash
git remote add upstream https://github.com/lobehub/lobehub.git
git fetch upstream
git merge upstream/canary
```

Customizations are limited to branding constants, one theme stylesheet, home page components and locale files, so merge conflicts should be rare.

---

## License

MIT, inherited from [LobeHub](https://github.com/lobehub/lobehub).
