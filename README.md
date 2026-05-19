<div align="center">

# Chinna Hub

**Lightweight · Fast Loading · AI-Powered Workspace**

Build, collaborate with, and evolve AI agents — without the bloat.

[![License][license-shield]][license-link]
[![Node][node-shield]][node-link]
[![pnpm][pnpm-shield]][pnpm-link]

</div>

---

## ✨ What is Chinna Hub?

Chinna Hub is a streamlined, white-label AI platform forked from LobeHub — rebuilt to be **lightweight, fast-loading, and production-ready** out of the box.

It gives you:
- 🤖 **AI Agents** — Create, customize, and share intelligent agents
- 💬 **Multi-model Chat** — OpenAI, Anthropic, Google Gemini, Ollama, and 30+ providers
- 🛠 **MCP Plugins** — One-click Model Context Protocol integrations
- 🎨 **Multimodal Generation** — Images, audio, and video via FAL, BFL, Replicate
- 🔐 **Auth** — Google OAuth + Email/Password with onboarding flow
- 📦 **Self-hosted** — Deploy on your own server, Vercel, or Docker
- �� **Locales** — English, తెలుగు (Telugu), Tinglish

---

## 🚀 Quick Start

### Prerequisites
- Node.js 22+
- pnpm 9+
- PostgreSQL 15+
- Redis 7+

### 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG/chinnahub.git
cd chinnahub
pnpm install
```

### 2. Configure environment

```bash
cp .env.example.chinnahub .env
# Fill in your values — see comments in the file for step-by-step setup
```

Minimum required variables:
| Variable | Description |
|---|---|
| `APP_URL` | Your app's public URL |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `KEY_VAULTS_SECRET` | `openssl rand -base64 32` |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `S3_*` | Object storage (R2 / MinIO / S3) |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `SMTP_*` | Email for verification & password reset |
| `OPENAI_API_KEY` | Or any AI provider key |

### 3. Run database migrations

```bash
pnpm run db:migrate
```

### 4. Start development

```bash
bun run dev
```

Open [http://localhost:3010](http://localhost:3010) — you'll be guided through onboarding.

---

## 🏗 Architecture

```
chinnahub/
├── apps/
│   ├── desktop/        # Electron desktop app
│   └── cli/            # CLI tool
├── packages/
│   ├── database/       # Drizzle ORM schema + migrations
│   ├── agent-runtime/  # AI provider adapters
│   └── ...
├── src/
│   ├── app/            # Next.js App Router (backend API)
│   ├── routes/         # SPA pages (Vite + React Router)
│   ├── features/       # Business UI components by domain
│   ├── store/          # Zustand state management
│   ├── server/         # TRPC routers + services
│   └── locales/        # i18n (en-US, te-IN, ti-IN)
└── locales/            # Translation files
```

**Stack**: Next.js 16 · React 19 · TypeScript · Drizzle ORM · PostgreSQL · Redis · TRPC · Zustand · antd · Better Auth

---

## 🐳 Docker Deployment

```bash
# Build
docker build -t chinnahub .

# Run with env file
docker run -d \
  --env-file .env \
  -p 3010:3010 \
  chinnahub
```

Or use docker-compose:

```bash
cp docker-compose/docker-compose.yml ./
docker compose up -d
```

---

## ☁️ Vercel Deployment

1. Fork this repo
2. Create project on [vercel.com](https://vercel.com)
3. Add environment variables from `.env.example.chinnahub`
4. Set `NEXT_PUBLIC_SERVICE_MODE=server`
5. Deploy — migrations run automatically on first boot

---

## 🔑 Auth Setup

### Google OAuth
1. [console.cloud.google.com](https://console.cloud.google.com) → Credentials → OAuth 2.0
2. Add redirect URI: `https://your-domain.com/api/auth/callback/google`
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

### Email / Password
- Set `AUTH_DISABLE_EMAIL_PASSWORD=0` (enabled by default)
- Configure `SMTP_*` variables for email verification
- Users can sign up → verify email → access full dashboard

---

## 🤖 AI Providers

Chinna Hub supports 30+ AI providers. Quick setup:

| Provider | Env Variable | Get Key |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| Google Gemini | `GOOGLE_API_KEY` | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Ollama (local) | `OLLAMA_PROXY_URL` | [ollama.com](https://ollama.com) (free) |
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com/keys) |
| OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai/keys) |
| DeepSeek | `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) |

---

## 🛡 Admin Dashboard

Chinna Hub includes a built-in admin panel at `/admin`:
- **Users** — view, role management (admin/user), ban/unban
- **AI Models** — enable/disable models per provider
- **Content** — agent and topic moderation
- **Stats** — system overview (users, messages, sessions)

Access requires `role = 'admin'` on your user account. Set it manually in the database for the first admin:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

---

## 🌍 Languages

| Locale | Language |
|---|---|
| `en-US` | English (default) |
| `te-IN` | తెలుగు (Telugu) |
| `ti-IN` | Tinglish |

---

## 📦 Database Migrations

All 104 migration files are preserved in `packages/database/migrations/`. The migration history ensures clean upgrades from any previous version.

```bash
# Apply all pending migrations
pnpm run db:migrate

# Generate new migration after schema changes
pnpm run db:generate
```

---

## 🤝 Contributing

1. Branch from `canary`
2. Use conventional commits with gitmoji
3. Run `bunx vitest run --silent='passed-only' [file]` for tests
4. Open PR targeting `canary`

---

## 📄 License

[Apache 2.0](./LICENSE) — Built on [LobeHub](https://github.com/lobehub/lobe-chat) open-source foundation.

---

<!-- LINKS -->
[license-shield]: https://img.shields.io/badge/license-Apache%202.0-blue
[license-link]: ./LICENSE
[node-shield]: https://img.shields.io/badge/node-22+-green
[node-link]: https://nodejs.org
[pnpm-shield]: https://img.shields.io/badge/pnpm-9+-orange
[pnpm-link]: https://pnpm.io
