# Development Environment Setup Guide

Welcome to the LobeChat project! This guide will help you set up your local development environment so you can start contributing quickly.

## Prerequisites

Before you begin, make sure you have the following installed on your system:

- **Node.js** (v18 or later) — [Download here](https://nodejs.org/)
- **pnpm** — Install via `npm install -g pnpm`
- **Bun** — Install via `curl -fsSL https://bun.sh/install | bash`
- **Git** — [Download here](https://git-scm.com/)
- **Docker** (optional, for running database locally) — [Download here](https://www.docker.com/)

## Cloning the Repository

```bash
# Fork the repository on GitHub first, then clone your fork
git clone https://github.com/<your-username>/lobe-chat.git
cd lobehub

# Add the upstream remote
git remote add upstream https://github.com/lobehub/lobe-chat.git

# Sync with upstream
git fetch upstream
git checkout canary
git merge upstream/canary
```

## Installing Dependencies

LobeChat uses **pnpm** for package management:

```bash
pnpm install
```

## Environment Variables

Create a `.env` file in the project root based on the example:

```bash
cp .env.example .env
```

At minimum, you will need:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_AUTH_SECRET` | Secret for NextAuth.js |
| `OPENAI_API_KEY` | OpenAI API key (for testing AI features) |

## Starting the Development Server

### Option 1: Full-Stack Development

```bash
# Start Next.js + Vite SPA concurrently
bun run dev
```

This launches both the backend API server and the frontend SPA dev server.

### Option 2: SPA Development Only

```bash
# Frontend-only mode (proxies API to a running backend)
bun run dev:spa
```

After the dev server starts, a **Debug Proxy** URL will be printed in the terminal. Open it in your browser to develop locally against the production backend with hot module replacement (HMR).

## Running Tests

```bash
# Run a specific test file (NEVER run `bun run test` — it takes ~10 minutes)
bunx vitest run --silent='passed-only' '<file-path>'

# Example: test a specific component
bunx vitest run --silent='passed-only' 'src/components/Button.test.tsx'

# Type checking
bun run type-check
```

## Project Structure Overview

```
lobechat/
├── src/
│   ├── app/          # Next.js App Router (backend + auth)
│   ├── routes/       # SPA page components
│   ├── features/     # Business components by domain
│   ├── store/        # Zustand state stores
│   ├── services/     # Client-side services
│   └── server/       # Server-side services and routers
├── packages/         # Shared packages (@lobechat/*)
├── public/           # Static assets
└── docs/             # Documentation
```

## Branch Strategy

- **`canary`** — Development branch (cloud production). Create new branches from here.
- **`main`** — Release branch (periodically cherry-picks from canary).

### Branch Naming Convention

```
<type>/<feature-name>
```

Examples:
- `feat/add-dark-mode-toggle`
- `fix/login-redirect-loop`
- `docs/update-readme`

### Commit Messages

Use [gitmoji](https://gitmoji.dev/) prefixes for commit messages:

```
✨ feat: add new feature
🐛 fix: resolve bug
📝 docs: update documentation
♻️ refactor: restructure code
✅ test: add tests
```

## Code Style and Linting

```bash
# Run linting
bun run lint

# Run type checking
bun run type-check
```

The project uses ESLint and Prettier. Your code should pass both before submitting a PR.

## Internationalization (i18n)

LobeChat supports multiple languages. When adding new UI text:

1. Add keys to the appropriate namespace file under `src/locales/default/`
2. For dev preview, add translations to `locales/zh-CN/` and `locales/en-US/`
3. Run `pnpm i18n` to update locale files when keys change

## Database Setup

LobeChat uses **Drizzle ORM** with **PostgreSQL**.

```bash
# Start PostgreSQL with Docker
docker compose up -d postgres

# Run database migrations
bun run db:migrate
```

## Submitting a Pull Request

1. Create a new branch from `canary`
2. Make your changes
3. Write or update tests as needed
4. Ensure all tests pass: `bunx vitest run`
5. Ensure type checking passes: `bun run type-check`
6. Commit your changes with descriptive messages
7. Push your branch and open a PR against `canary`

## Getting Help

- **GitHub Issues** — Search existing issues or create a new one
- **Discussions** — Join the conversation in GitHub Discussions
- **Discord** — Connect with the community

---

Thank you for contributing to LobeChat! 🚀
