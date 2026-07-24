# PROJECT.md — agent-testing adapter for LobeHub

This is the LobeHub adapter for the generic `agent-testing` skill. The skill is
project-agnostic; every LobeHub-specific command, port, service, and probe lives
here. The skill reads this file — it never guesses LobeHub's commands.

Scripts referenced below live under `.agents/acceptance/scripts/`. The generic skill
and its own scripts (`report-init.sh`, `cdp-screenshot.sh`, `record-gif.sh`,
`check-screen-recording.sh`, …) are installed at `.agents/skills/agent-testing/`.

## 1. Project summary

LobeHub is a chat/agent product with a Next.js server, a Vite + React SPA, an
Electron desktop shell, and a CLI (`lh`). Repo layout that matters for testing:

- `apps/server/` — the Next.js backend (TRPC routers, services, modules, auth).
- `apps/desktop/` — the Electron shell. **Standalone install** (see §6).
- `apps/cli/` — the `lh` CLI; runs from source (`bun src/index.ts`), no rebuild.
  **Standalone install** (see §6).
- `packages/**`, `e2e`, `apps/server` — covered by the root pnpm workspace.
- `src/` — the SPA and shared web app; `src/server/` holds agent-hono /
  workflows-hono.

**The root pnpm workspace does NOT cover `apps/desktop` or `apps/cli`.**
`pnpm-workspace.yaml` lists `packages/**`, `e2e`, `apps/server`, and only
`apps/desktop/src/main`. Those two apps keep their own `node_modules` with their
own links into `packages/`; a root install does not refresh them. Symptom of a
stale standalone install: a recently added workspace package fails to resolve —
`Rolldown failed to resolve import "@lobechat/<pkg>"` (Electron) or
`Cannot find module '@lobechat/<pkg>'` (CLI).

## 2. Environment

- **Start dev server:**

  - With repo-root `.env` present: use the existing local config — `bun run dev`
    (full-stack, needed for Web smoke) or `AGENT_RUNTIME_MODE=queue pnpm run dev:next`
    (backend only). Do NOT call any `init-dev-env.sh` subcommand when `.env` exists.
  - Without `.env`: use the skill-owned bootstrap `.agents/acceptance/scripts/init-dev-env.sh`
    (Postgres, Redis, migrations, auth/key-vault/S3 test env, seed user, then the
    repo's own dev server — not `e2e/scripts/setup.ts`). It hard-blocks when
    root `.env` exists, so it can never override a user's local config.

  ```bash
  if [[ -f .env ]]; then
    bun run dev
  else
    .agents/acceptance/scripts/init-dev-env.sh setup-db
    .agents/acceptance/scripts/init-dev-env.sh s3 # terminal B — keep running
    .agents/acceptance/scripts/init-dev-env.sh seed-user
    .agents/acceptance/scripts/init-dev-env.sh dev
  fi
  ```

  `dev-next` starts the Next.js backend only; Web smoke needs the full-stack
  `dev` so Next proxies the SPA HTML from Vite. `bun run dev:spa` runs the Vite
  SPA alone, proxying the API to `PORT`.

- **Stop dev server (must stop only what THIS run started):**

  ```bash
  .agents/acceptance/scripts/init-dev-env.sh clean    # stop the recorded dev-server PID tree; keep DB/Redis
  .agents/acceptance/scripts/init-dev-env.sh stop-dev # just the server, no note
  ```

  `clean` stops only the recorded dev-server PID tree after verifying its PID
  start time, command, and working directory; it never matches by process name
  and never kills a listener merely because it owns a persisted port. It leaves
  the managed Postgres/Redis containers running (reused across runs — `setup-db`
  is a no-op when they are up). `clean-db` removes the managed DB container;
  `clean-s3` removes persisted local S3 objects. If the user started their own
  `.env` dev server, leave it — you did not start it.

- **Required services:**
  - **Postgres + Redis** — `init-dev-env.sh setup-db` (managed Docker containers
    `lobehub-agent-testing-postgres` / `lobehub-agent-testing-redis`; requires
    Docker Desktop). To use an existing DB instead, set `DATABASE_URL` /
    `REDIS_URL` and skip `setup-db` (run `migrate` + `seed-user` with those env).
  - **s3rver (local S3)** — `init-dev-env.sh s3` (terminal B). A hard prerequisite
    for browser uploads, presigned URLs, attachments, and generated files: the
    no-`.env` bootstrap points the app at local `s3rver` so those exercise a real
    S3 HTTP round trip. Creates `agent-testing-bucket`, configures CORS for the
    allocated local origins, persists objects under
    `.records/data/agent-testing-s3`. Fixed `S3RVER` credentials are required by
    the emulator's presigned-URL validation. `preflight` does HeadBucket + a real
    Put/Get/Delete round trip; a listening port alone is not "ready".
  - **QStash** — `init-dev-env.sh qstash` (terminal B). A hard prerequisite for
    ANY agent-runtime test (see §6).

- **Already-running detection:**

  ```bash
  curl -s -o /dev/null -w '%{http_code}' "$SERVER_URL/"
  ```

- **Env / port resolution:** `.agents/acceptance/scripts/test-env.sh` is the source
  of truth for local test ports — do NOT hard-code a port table. It reads the
  current shell plus `.env` files with the same precedence as
  `scripts/runWithEnv.mts` and prints `APP_URL`, `PORT`, `SERVER_URL`,
  `AUTH_TRUSTED_ORIGINS`, `SPA_PORT`, `MOBILE_SPA_PORT`, `DESKTOP_PORT`.

  ```bash
  .agents/acceptance/scripts/test-env.sh                     # print resolved env + ports
  eval "$(.agents/acceptance/scripts/test-env.sh --exports)" # export them
  ```

  Default script env (no-`.env` bootstrap): `APP_URL=http://localhost:3010`,
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres`,
  `DATABASE_DRIVER=node`, `AGENT_RUNTIME_MODE=queue`,
  `REDIS_URL=redis://localhost:6380`, `FEATURE_FLAGS=-agent_self_iteration`,
  `KEY_VAULTS_SECRET`, `AUTH_SECRET`, auth verification off, plus local `s3rver`
  and local QStash vars. Treat the dev-server terminal output as final when the
  port is non-standard, then `export SERVER_URL=http://localhost:<port>`.

  In the cloud repo (this repo as the `lobehub/` submodule), worktree names map
  to fallback `SERVER_URL` defaults only when `.env` and shell env give none:
  `lobehub`→3010, `lobehub-cloud`→3020, `lobehub-cloud-N`→`3020+N`.

- **Cucumber note:** when running Cucumber against this dev server in the no-`.env`
  branch, pass the same script env into the test process (`eval "$(.agents/acceptance/scripts/init-dev-env.sh env)"`)
  — Cucumber's own `BeforeAll` seed path must see `DATABASE_URL` or it silently
  skips setup.

- **Ports/modes table, the per-path server-restart matrix, and env
  troubleshooting:** `.agents/acceptance/references/dev-server.md`.

## 3. Auth

- **Test account:** `agent-testing@lobehub.com` / `TestPassword123!`, onboarding
  completed. Created by `init-dev-env.sh seed-user`, which also writes a local
  CLI API key to `.records/env/agent-testing-cli.env`.

- **Seeding command:** `.agents/acceptance/scripts/init-dev-env.sh seed-user`.

- **Setup helper:** `.agents/acceptance/scripts/setup-auth.sh` — `status` (all
  surfaces), `status --surface <cli|web|electron>`, `cli-seed`, `cli` (interactive
  device-code, user runs it), `web-seed`, `open-chrome`, `web` (inject a copied
  Cookie header), `web-verify`. Auth is a surface-scoped gate: pick the intended
  surface and check only it (do not block a Web test on CLI device-code auth).

- **Per-surface status check:**

  | Surface  | Mechanism                                     | One-key path             | Standard check                            |
  | -------- | --------------------------------------------- | ------------------------ | ----------------------------------------- |
  | CLI      | Seeded API key, device-code fallback          | `setup-auth.sh cli-seed` | `setup-auth.sh status --surface cli`      |
  | Web      | Seeded better-auth login into `agent-browser` | `setup-auth.sh web-seed` | `setup-auth.sh status --surface web`      |
  | Electron | The app's own persistent login state          | log in once in the app   | `setup-auth.sh status --surface electron` |

- **Chrome-cookie fallback (Web only):** ordinary Chrome is only a source for
  copying the better-auth session cookie into the `agent-browser` session
  (`lobehub-dev`) when seed auth is unavailable or `status --surface web` still
  fails. Copy the `Cookie:` header from the Network tab (NOT `document.cookie` —
  HttpOnly cookies are invisible there), then `pbpaste | setup-auth.sh web`. Use
  `localhost`, not `127.0.0.1` (better-auth cookies are stored for `localhost`).
  Never do this against production. Full decision flow, seeded-login mechanics,
  and failure modes: `.agents/acceptance/references/auth.md`.

- **Login-state check** is standardized — do NOT hand-roll a `window.__LOBE_STORES`
  eval; use `.agents/acceptance/scripts/app-probe.sh auth` (returns `{ isSignedIn, userId }`,
  works for Electron CDP and web sessions via `AB_TARGET`).

## 4. Surfaces

### CLI

- Invocation: from source, no rebuild — `cd apps/cli && bun src/index.ts <cmd>`
  (referred to as `$CLI`). CLI-side code changes take effect immediately.
- Auth: see §3 CLI. Source the seeded profile first:
  `source .records/env/agent-testing-cli.env`. It sets `LOBE_API_KEY` /
  `LOBEHUB_CLI_API_KEY`, `LOBEHUB_SERVER=http://localhost:3010`, and
  `LOBEHUB_CLI_HOME=.lobehub-dev` for isolated settings.
- **Local-run vs publish env distinction:** those seeded overrides are for
  _running_ the local backend test. They are WRONG for _publishing_ — a localhost
  run yields a verify URL nobody else can open, and the local stub S3 makes
  evidence upload fail. Strip them for the publish step (the skill's Step 6 does
  `env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME lh verify ingest-report …`
  so `lh` uses production defaults + the user's real `~/.lobehub` login).
- Standalone install: `cd apps/cli && pnpm install` (root install does not cover it).

### Web

- Launch: full-stack dev server from §2 (`bun run dev` or `init-dev-env.sh dev`).
- Base URL: `$SERVER_URL` (default `http://localhost:3010`).
- agent-browser session: `lobehub-dev`. Seed it with `setup-auth.sh web-seed`;
  drive it as the sole evidence source (do not use ordinary Chrome screenshots
  or Network records as proof). Full-stack is the one surface where network
  requests and rendered UI are observable together — assert both.
- SPA proxying note: Web smoke needs the full-stack `dev` so Next proxies the
  SPA HTML from Vite; `dev-next` alone will not serve the SPA.
- Local frontend against production backend: `bun run dev:spa` prints a
  `_dangerous_local_dev_proxy` URL that loads your local Vite SPA inside the
  online environment (HMR against real server config) — for verifying frontend
  behavior against production data only, NOT for testing backend branch changes.

### Electron

- Launch: `.agents/acceptance/scripts/electron-dev.sh start` — CDP port `9222`
  (idempotent; `status` / `stop` / `restart`; env `CDP_PORT`, `ELECTRON_LOG`,
  `ELECTRON_WAIT_S`, `RENDERER_WAIT_S`, `LOBE_LOGIN_STATE_DIR`, `KEEP_DATA`,
  `SKIP_LOGIN_SAVE`). Connect with `agent-browser --cdp 9222 snapshot -i`.
- Stop: `.agents/acceptance/scripts/electron-dev.sh stop` — always use this;
  `pkill -f "Electron"` leaves helper processes (GPU, renderer, network) alive.
- Login persistence: `stop` snapshots the login to
  `~/.lobehub/agent-testing/electron-login`; `start` seeds each new instance
  from it (`login-status` inspects it, `save-login <id>` captures a live one).
  Sign in once, not once per run — and if an instance comes up signed out,
  **inject the login state directly** (restore the snapshot, or mint it via
  CLI/API seeding; recipes and the three token-rotation traps are in
  `.agents/acceptance/references/auth.md`). **Never trigger the OAuth flow
  (`requestAuthorization`)** — it opens a login page in the user's default
  browser, against a per-instance localhost origin that usually can't even
  complete. If no injectable state exists, report auth as blocked and ask for
  one manual sign-in instead.
- Concurrent instances (N worktrees / parallel runs): `electron-dev.sh` drives a
  pool — `start <id>` gives each its own CDP port, userData dir (with copied
  login), Vite port, and IPC id. Drive each with a distinct
  `agent-browser --session s<port> --cdp <port>`. Pool design, the collision
  matrix, and the login-copy recipe: `.agents/acceptance/references/multi-instance.md`.

### Bot channels (project skill)

Bot-channel surfaces (Discord / Slack / Telegram / WeChat / Lark / QQ / iMessage)
live in a separate LobeHub project skill, `agent-testing-bot`
(`.agents/skills/agent-testing-bot/`). It extends this same Plan/Execute/Finish
process and report pipeline for the native-app surfaces (osascript / bridge,
macOS-only). Route bot tests there.

## 5. Project probes & quick navigation

`.agents/acceptance/scripts/app-probe.sh` is the LobeHub fast path into app state —
use it instead of hand-rolling `window.__LOBE_STORES` eval snippets. Targets
default to Electron (`--cdp 9222`); set `AB_TARGET="--session <name>"` for web
sessions.

```bash
PROBE=.agents/acceptance/scripts/app-probe.sh
$PROBE auth           # login check → { isSignedIn, userId }
$PROBE ready          # app root + exposed-store readiness
$PROBE server-auth    # authenticated server request → 200 vs 401
$PROBE route          # current SPA route
$PROBE stores         # exposed store names
$PROBE ops            # running chat operations (type / startTime)
$PROBE wait-ops 60    # wait until no chat operation is running
$PROBE topic          # active topic + metadata from its paged view
$PROBE goto /settings # jump the SPA straight to a route (full reload)
$PROBE errors-install # install console.error interceptor
$PROBE errors         # dump captured errors
```

Routes worth jumping to:

| Route                        | Where it lands                    |
| ---------------------------- | --------------------------------- |
| `/`                          | Home (has a chat input)           |
| `/agent/<agentId>`           | Agent conversation (latest topic) |
| `/agent/<agentId>/<topicId>` | Specific topic in a conversation  |
| `/task` · `/task/<taskId>`   | Task list / task detail           |
| `/page`                      | Documents (文稿)                  |
| `/settings`                  | Settings                          |
| `/community`                 | Discover / community              |

The Zustand store is at `window.__LOBE_STORES` (not `__ZUSTAND_STORES__`); the
chat input is `contenteditable` (snapshot with `-C`). For deeper one-off state
inspection, fall back to raw `agent-browser --cdp 9222 eval`. The agent-gateway
closed-loop probe/dump/analyze tooling lives at
`.agents/acceptance/scripts/agent-gateway/`; the closed-loop + JWKS setup workflow is
in `.agents/acceptance/references/agent-gateway.md`.

## 6. Known constraints

- **QStash is a hard prerequisite for ANY agent-runtime test.** Any test that
  runs an agent (`lh agent run`, durable ops, `/api/agent/run`, the server agent
  runtime) goes through `AGENT_RUNTIME_MODE=queue` (the default here and in
  production). Creating an agent operation POSTs to local QStash
  (`127.0.0.1:8080`); if QStash is down the run dies at operation creation with
  `TypeError: fetch failed` / `ECONNREFUSED 127.0.0.1:8080` **before any LLM
  call** — no trace is recorded and it reads as unrelated to the env. Start it
  and gate before the first `agent run`:

  ```bash
  .agents/acceptance/scripts/init-dev-env.sh qstash    # terminal B — keep running
  .agents/acceptance/scripts/init-dev-env.sh preflight # non-zero exit if QStash (or Redis) is down
  ```

  `FEATURE_FLAGS=-agent_self_iteration` only drops the self-iteration workflow
  (so a simple chat does not fan out); it does NOT remove QStash from the
  agent-runtime dispatch path. Treat QStash as required, not an "only-for-workflow"
  nicety.

- **Verify which runtime actually ran — do not assume.** Some features have two
  execution paths and the UI silently picks one. Group orchestration is the
  concrete example: the chat UI defaults to the **client** runtime, while a fix
  may live in the **server** runtime / `AGENT_RUNTIME_MODE=queue` durable-op path.
  A test that exercises the wrong path passes green without touching the code
  under test. Prove which ran (a server `agent_operations` row, the QStash
  `/api/agent/run` steps, server-only log lines); if the UI will not take the
  server path, drive it directly (call the server TRPC mutation / endpoint).

- **`apps/desktop` and `apps/cli` are standalone installs** (see §1) — run
  `pnpm install` inside each app the test will touch, not only at the root.

- **Server restart picks up server-side code changes.** Next.js hot-reload may
  miss changes in workspace packages. Restart when changing `apps/server/src/`,
  `src/server/`, `packages/database/`, `packages/types/`, `packages/prompts/`;
  `apps/cli/` needs none (runs from source).

- **OS-capture surfaces are macOS-only** (bot channels, `capture-app-window.sh`,
  osascript screenshots): they come out black without Screen Recording (TCC)
  permission or when the display is asleep/locked. CDP-based evidence
  (`agent-browser screenshot`, the installed skill's `cdp-screenshot.sh`) is
  unaffected. Electron runs on Linux/cloud only under `xvfb-run`, and there OS
  capture does not work — prefer CDP evidence for cloud-portable runs.

- **`ENABLE_MOCK_DEV_USER` is not Web auth** — it only affects server-side API
  context and does not satisfy Better Auth or stop the SPA redirect to `/signin`.

- Marketplace/community endpoints are not part of the local auth gate; do not
  block local verification on marketplace API auth unless the change targets it.

## Project references

Deeper LobeHub-specific notes kept alongside the moved scripts:

- `.agents/acceptance/references/auth.md` — per-surface auth mechanics, the seeded
  web-login flow, the Electron OAuth+PKCE sign-in recipe and token-rotation traps,
  and the Chrome cookie-injection fallback + failure modes.
- `.agents/acceptance/references/agent-gateway.md` — the local agent-gateway
  closed-loop setup / probe / dump / analyze workflow (scripts under
  `.agents/acceptance/scripts/agent-gateway/`).
- `.agents/acceptance/references/multi-instance.md` — the concurrent Electron
  instance pool (N worktrees / parallel runs): per-instance CDP port, userData,
  Vite port, IPC id, the collision matrix, and the login-copy recipe.
- `.agents/acceptance/references/probe-field-notes.md` — historical, detailed
  LobeHub probe incidents and their original cross-reference ids.
- `.agents/acceptance/references/common-mistakes-field-notes.md` — original
  incident narratives retained after the maintained catalogue was normalized.

The living logs (`.agents/acceptance/common-mistakes.md`,
`.agents/acceptance/probe-mock-patterns.md`) hold the LobeHub-specific probe/mock and
mistake recipes; the generic layer lives in the installed skill's `references/`.
