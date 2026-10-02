# LobeHub WP（lobehub_wp）

**简体中文** · [English](#english)

> 本仓库 Fork 自官方 [lobehub/lobehub](https://github.com/lobehub/lobehub)，在其基础上新增了提示词增强等定制功能，并已部署至 Vercel：<https://lobehub-wp.vercel.app>

LobeHub 是一个开源的 AI Agent（智能体）工作台：支持多模型对话、智能体编排、多端访问（Web / 桌面端 / 移动 Web），并提供用户系统、知识库、插件等能力。

---

## 目录

- [本分支定制功能](#本分支定制功能)
- [功能列表](#功能列表)
- [技术栈](#技术栈)
- [环境要求](#环境要求)
- [本地安装步骤](#本地安装步骤)
- [环境变量说明](#环境变量说明)
- [使用说明](#使用说明)
- [Vercel 部署说明](#vercel-部署说明)
- [分支说明](#分支说明)

---

## 本分支定制功能

1. **提示词增强（新增功能，灯泡按钮）**
   - 在聊天输入框工具栏新增灯泡按钮，提供两个操作：
     - **丰富细节**：把一句话扩写为完整、具体、有想象力的多句提示词（背景目标、角色风格、内容要求、结构格式、约束边界等）
     - **翻译**：将输入内容翻译为英文
   - **使用当前对话模型**执行改写（如 GPT-OSS 120B），无需单独配置改写模型
   - **语言自动跟随**：中文输入输出中文，英文输入输出英文
   - 已覆盖：首页、智能体对话页、群组对话页
2. **浅薰衣草紫主题**：全端浅色模式背景由浅灰 `#f8f8f8` 统一改为浅紫（布局 `#F5F0FA` / 卡片 `#FAF6FD`），深色模式不受影响
3. **用户名修改修复**：改走 Better Auth 更新接口，解决会话缓存导致用户名跳回旧值的问题
4. **Vercel 部署适配修复**：`@upstash/qstash` 补丁适配 2.12.0；Neon 数据库迁移对 `pg_search` 扩展做容错（配合 `FTS_SEARCH_PROVIDER=pg_like`）

## 功能列表

- 💬 **多模型对话**：兼容 OpenAI 接口协议，支持在界面内配置任意供应商与模型
- 🤖 **智能体（Agent）**：创建、编排、定时调度智能体，支持群组（多 Agent）对话
- 💡 **提示词增强**：一键丰富细节 / 翻译（本分支新增）
- 🔐 **用户系统**：注册登录（Better Auth）、个人资料、多端会话
- 📚 **知识库 / 文件**：基于 S3 兼容对象存储的文件上传与知识库（需配置 S3）
- 🔌 **插件生态**：沿用上游 LobeHub 插件体系
- 🖥️ **多端支持**：Web、桌面端（Electron）、移动 Web、分享页、工作台等多个子应用
- 🌐 **国际化**：内置多语言（含简体中文）

## 技术栈

- **框架**：Next.js（App Router）+ React + TypeScript（Monorepo，pnpm workspace）
- **子应用**：React Router（auth / share / workbench）、Vite + Electron（desktop）
- **服务端**：tRPC、Drizzle ORM、Better Auth
- **数据库**：PostgreSQL（本地开发可用任意 PG 实例；线上使用 Neon Serverless PG）
- **对象存储**：S3 兼容服务（本地可用 MinIO，线上可选 Backblaze B2 / Cloudflare R2 / AWS S3）
- **包管理 / 运行时**：pnpm 12.4.1 + Bun
- **部署**：Vercel（根目录 `vercel.json` 已配置）

## 环境要求

| 依赖        | 版本要求                           |
| ----------- | ---------------------------------- |
| Node.js     | 24（`.nvmrc` 为 `lts/krypton`）    |
| pnpm        | 12.4.1                             |
| Bun         | 最新版（构建脚本依赖）             |
| PostgreSQL  | 15+                                |
| S3 兼容存储 | MinIO / B2 / R2 等（文件功能必需） |

## 本地安装步骤

```bash
# 1. 克隆仓库
git clone git@github.com:zhangsan301/lobehub_wp.git
cd lobehub_wp

# 2. 安装依赖（必须使用 pnpm 12.4.1）
npx pnpm@12.4.1 install

# 3. 准备环境变量
#    仓库已自带 .env.development，默认连接：
#    PostgreSQL -> localhost:5432（库名 lobechat，用户 postgres）
#    S3(MinIO)  -> localhost:9000（桶名 lobe）
#    请先自行启动 PostgreSQL 与 MinIO，并按实际情况修改 .env.development

# 4. 数据库迁移
bun run db:migrate

# 5. 启动开发服务器
bun dev
```

启动后访问 <http://localhost:3010>。

### 生产构建

```bash
bun run build      # 构建全部子应用 + Next.js
bun start          # 启动生产服务，监听 http://localhost:3210
```

## 环境变量说明

核心变量（完整列表参考 `.env.development`）：

| 变量                                        | 说明                                          | 示例                                                |
| ------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `DATABASE_URL`                              | PostgreSQL 连接串                             | `postgresql://postgres:***@localhost:5432/lobechat` |
| `KEY_VAULTS_SECRET`                         | 数据库内 API Key 的加密密钥（32 字节 base64） | 随机生成，配好后不可更改                            |
| `AUTH_SECRET`                               | 用户登录会话签名密钥                          | 随机生成                                            |
| `JWKS_KEY`                                  | 内部服务 JWT 签名 RSA 密钥（JWKS JSON）       | 按官方文档生成                                      |
| `APP_URL`                                   | 应用根地址                                    | `http://localhost:3010`                             |
| `FTS_SEARCH_PROVIDER`                       | 全文搜索实现，无 pg_search 扩展时填 `pg_like` | `pg_like`                                           |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 对象存储凭证                                  | —                                                   |
| `S3_ENDPOINT` / `S3_BUCKET`                 | S3 端点与桶名                                 | `http://localhost:9000` / `lobe`                    |
| `S3_PUBLIC_DOMAIN`                          | 文件公开访问域名（头像、附件）                | 线上必填                                            |
| `OPENAI_API_KEY`                            | OpenAI 兼容 API 密钥（也可在应用界面内配置）  | `sk-...`                                            |

## 使用说明

1. 打开首页，注册账号并完成 onboarding 引导
2. 点击左下角**设置 → 语言模型**，添加你的模型供应商：
   - 填入 API Key、BaseURL（第三方兼容网关时）、模型 ID（如 `gpt-oss-120b`）
3. 在对话页模型选择器中选中该模型即可开始对话
4. **使用提示词增强**：在输入框输入一句话（如 "写一首关于秋天的诗"）→ 点击输入框右侧**灯泡图标** → 选择「丰富细节」或「翻译」→ 结果自动回填到输入框，可继续编辑后发送
5. 文件上传、头像、知识库功能需先配置好 S3 兼容存储

## Vercel 部署说明

线上地址：<https://lobehub-wp.vercel.app>

要点（均已在本仓库处理好）：

1. **以单项目导入**：Vercel 检测到 monorepo 多个应用时，选择根目录 `app (Next.js, /)` 的 **Import single project**，不要使用多服务（Services）向导
2. **生产分支**：`canary`（Settings → Git → Production Branch）
3. **构建命令**：自动读取根目录 `vercel.json` 的 `bun run build:vercel`
4. **数据库**：创建 Neon Serverless Postgres 并关联项目（自动注入 `DATABASE_URL`）
5. **必填环境变量**：`KEY_VAULTS_SECRET`、`AUTH_SECRET`、`JWKS_KEY`、`APP_URL`、`FTS_SEARCH_PROVIDER=pg_like`；文件功能还需 `S3_*` 一组
6. 推送到 `canary` 分支即自动触发部署

## 分支说明

- `canary`：部署用主干，包含全部定制功能与部署修复
- `feature/add-prompt-enhancer`：提示词增强功能开发分支（已合并进 canary）

---

<a name="english"></a>

# English

> This repository is a fork of [lobehub/lobehub](https://github.com/lobehub/lobehub) with custom features such as Prompt Enhancement. Live deployment on Vercel: <https://lobehub-wp.vercel.app>

LobeHub is an open-source AI Agent workbench: multi-model chat, agent orchestration, and access across Web, Desktop and Mobile Web, with authentication, knowledge base, plugins and more.

## Custom Changes in This Fork

1. **Prompt Enhancement (new feature, lightbulb button)**
   - A lightbulb button in the chat input toolbar with two actions:
     - **Enrich details**: expands a one-line prompt into a detailed, imaginative multi-sentence prompt (background & goals, role & style, content requirements, structure, constraints)
     - **Translate**: translates the input into English
   - Runs on the **currently selected chat model** (e.g. GPT-OSS 120B) — no separate rewrite model required
   - **Language follows input**: Chinese in → Chinese out; English in → English out
   - Available on the home page, agent conversation page, and group conversation page
2. **Light lavender theme**: light-mode backgrounds changed from grey `#f8f8f8` to lavender (`#F5F0FA` layout / `#FAF6FD` cards); dark mode untouched
3. **Username update fix**: now goes through the Better Auth update API, fixing stale session cache reverting the username
4. **Vercel deployment fixes**: regenerated `@upstash/qstash` patch for 2.12.0; graceful fallback in DB migrations when the Neon `pg_search` extension is unavailable (use with `FTS_SEARCH_PROVIDER=pg_like`)

## Features

- 💬 **Multi-model chat**: OpenAI-compatible; configure any provider/model in the UI
- 🤖 **Agents**: create, orchestrate and schedule agents; group (multi-agent) chats
- 💡 **Prompt Enhancement**: one-click enrich / translate (new in this fork)
- 🔐 **Auth & users**: sign up/sign in (Better Auth), profiles, multi-device sessions
- 📚 **Knowledge base / files**: uploads via S3-compatible storage (S3 config required)
- 🔌 **Plugins**: inherits the upstream LobeHub plugin ecosystem
- 🖥️ **Multi-surface**: Web, Desktop (Electron), Mobile Web, share page, workbench
- 🌐 **i18n**: built-in multi-language support including Simplified Chinese

## Tech Stack

- **Framework**: Next.js (App Router) + React + TypeScript monorepo (pnpm workspace)
- **Sub-apps**: React Router (auth / share / workbench), Vite + Electron (desktop)
- **Server**: tRPC, Drizzle ORM, Better Auth
- **Database**: PostgreSQL (Neon Serverless PG in production)
- **Object storage**: S3-compatible (MinIO locally; Backblaze B2 / Cloudflare R2 / AWS S3 online)
- **Tooling**: pnpm 12.4.1 + Bun
- **Deploy**: Vercel (configured via root `vercel.json`)

## Requirements

| Dependency            | Version                                           |
| --------------------- | ------------------------------------------------- |
| Node.js               | 24 (`.nvmrc`: `lts/krypton`)                      |
| pnpm                  | 12.4.1                                            |
| Bun                   | latest (required by build scripts)                |
| PostgreSQL            | 15+                                               |
| S3-compatible storage | MinIO / B2 / R2 etc. (required for file features) |

## Local Development

```bash
# 1. Clone
git clone git@github.com:zhangsan301/lobehub_wp.git
cd lobehub_wp

# 2. Install dependencies (pnpm 12.4.1 required)
npx pnpm@12.4.1 install

# 3. Environment variables
#    .env.development is included and defaults to:
#    PostgreSQL -> localhost:5432 (db: lobechat, user: postgres)
#    S3 (MinIO) -> localhost:9000 (bucket: lobe)
#    Start PostgreSQL and MinIO first, and edit .env.development if needed.

# 4. Run database migrations
bun run db:migrate

# 5. Start the dev server
bun dev
```

Open <http://localhost:3010>.

### Production Build

```bash
bun run build      # builds all sub-apps + Next.js
bun start          # serves on http://localhost:3210
```

## Environment Variables

| Variable                                    | Description                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | PostgreSQL connection string                                                      |
| `KEY_VAULTS_SECRET`                         | Encryption key for API keys stored in DB (32-byte base64; never change after set) |
| `AUTH_SECRET`                               | Signing secret for auth sessions                                                  |
| `JWKS_KEY`                                  | RSA key set (JWKS JSON) for internal JWT signing                                  |
| `APP_URL`                                   | App base URL, e.g. `http://localhost:3010`                                        |
| `FTS_SEARCH_PROVIDER`                       | `pg_like` when the pg_search extension is unavailable                             |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Object storage credentials                                                        |
| `S3_ENDPOINT` / `S3_BUCKET`                 | S3 endpoint and bucket                                                            |
| `S3_PUBLIC_DOMAIN`                          | Public domain for avatars/files (required online)                                 |
| `OPENAI_API_KEY`                            | OpenAI-compatible API key (can also be set in the app UI)                         |

## Usage

1. Open the home page, sign up and finish onboarding
2. Go to **Settings → Language Models**, add your provider: API Key, BaseURL (for compatible gateways), and model ID (e.g. `gpt-oss-120b`)
3. Select the model in the conversation header and start chatting
4. **Prompt Enhancement**: type a short prompt → click the **lightbulb icon** next to the input → choose "Enrich details" or "Translate" → the result fills the input box for review before sending
5. Avatars, uploads and the knowledge base require a working S3-compatible storage

## Vercel Deployment

Live: <https://lobehub-wp.vercel.app>

Key points (already handled in this repo):

1. **Import as a single project**: when Vercel detects multiple apps, choose **Import single project** for the root `app (Next.js, /)` — do NOT use the multi-service wizard
2. **Production branch**: `canary` (Settings → Git → Production Branch)
3. **Build command**: `bun run build:vercel` from the root `vercel.json`
4. **Database**: create a Neon Serverless Postgres and connect it to the project (injects `DATABASE_URL`)
5. **Required env vars**: `KEY_VAULTS_SECRET`, `AUTH_SECRET`, `JWKS_KEY`, `APP_URL`, `FTS_SEARCH_PROVIDER=pg_like`; plus the `S3_*` group for file features
6. Pushing to `canary` triggers an automatic deployment

## Branches

- `canary`: production branch deployed to Vercel; contains all custom features and deployment fixes
- `feature/add-prompt-enhancer`: development branch for Prompt Enhancement (merged into canary)
