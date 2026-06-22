---
name: agent-testing
description: >
  Agentic end-to-end testing for LobeHub: backend verification via the CLI,
  frontend verification via agent-browser (Electron), full-stack verification in
  the browser, and bot-channel verification via osascript. Local-first today,
  designed to extend to cloud automation. Triggers on 'cli test', 'test with cli',
  'verify with cli', 'backend test with cli', 'local test', 'test in electron',
  'test desktop', 'test bot', 'bot test', 'test in discord', 'test in telegram',
  'test in slack', 'test in wechat', 'test in weixin', 'test in lark', 'test in feishu',
  'test in qq', 'manual test', 'osascript', 'test report', or any local
  end-to-end verification task.
---

# Agent Testing (Agentic End-to-End Verification)

One skill for all agentic end-to-end testing — local-first today, designed to
also run as full cloud automation. Every test session follows the same
contract:

```
Step -1: Plan approval  →  Step 0: Env + Auth  →  Step 1: Pick surface  →  Step 2: Run  →  Step 3: Structured report  →  Step 4: Publish to LobeHub
```

## Step -1 — Plan approval for non-trivial tests

Skip directly to Step 0 if: the test is a single re-run after a fix, the plan
was already agreed on, or the user gave exact commands.

Otherwise, propose a test plan (surface, cases, expected evidence, assumptions)
and use the runtime structured question tool (`request_user_input` /
ask-user-question equivalent) with two fixed choices:

1. `开始执行 (Recommended)` — 测试方案没问题，开始执行
2. `先讨论下` — 方案有问题，先讨论下

Wait for the user's choice before proceeding.

## Step 0 — Environment setup + auth check (mandatory)

Step 0 is about getting the environment ready: **dependencies are healthy**
and **auth is green**. A test run that dies halfway on a missing dependency or
a login wall wastes the whole session — clear both gates BEFORE writing a
single test step.

### 0.0 Resolve the current test environment

Before starting a dev server, checking auth, opening agent-browser, or writing
test steps, print and confirm the current local test environment:

```bash
./.agents/skills/agent-testing/scripts/test-env.sh
```

This command is the source of truth for local test ports. It reads the current
shell plus `.env` files using the same precedence as `scripts/runWithEnv.mts`,
then prints:

- `APP_URL`
- `PORT`
- `SERVER_URL`
- `AUTH_TRUSTED_ORIGINS`
- `SPA_PORT`
- `MOBILE_SPA_PORT`
- `DESKTOP_PORT`

For commands that need these values, export them from the same resolver:

```bash
eval "$(./.agents/skills/agent-testing/scripts/test-env.sh --exports)"
```

Do not rely on hard-coded port tables. If the printed values do not match the
running dev server, fix/export the env first, then continue.

### 0.1 Dependencies are installed — root AND standalone apps

The root pnpm workspace does **NOT** cover every app: `pnpm-workspace.yaml`
lists `packages/**`, `e2e`, `apps/server`, and only `apps/desktop/src/main` —
**`apps/desktop` and `apps/cli` are standalone**, each keeping its own
`node_modules` with its own links into `packages/`. A root install does not
refresh them, so install in every app the test will touch:

```bash
pnpm install                    # root workspace
cd apps/desktop && pnpm install # Electron surface
cd apps/cli && pnpm install     # CLI surface
```

Symptom of a stale standalone install: the build/launch fails to resolve a
recently added workspace package — `Rolldown failed to resolve import
"@lobechat/<pkg>"` (Electron) or `Cannot find module '@lobechat/<pkg>'` (CLI).

### 0.2 Run scripts from the repo root

All paths in this skill (`./.agents/skills/agent-testing/...`) are
repo-root-relative, and background commands inherit the current working
directory — a script launched while `cwd` is `apps/desktop` fails with
`No such file or directory`. Verify `pwd` is the repo root before launching
long-running scripts.

### 0.3 Init local dev env without `.env`

For Web smoke against local code, start a **normal local dev environment**.
First check the repo root for `.env`:

- If `.env` exists, use the existing local configuration and start the dev
  server normally.
- If `.env` does not exist, use the agent-testing env bootstrap.

Do not start the standalone e2e server as the product under test.

Use `scripts/init-dev-env.sh`. It follows the e2e setup pattern — Postgres,
Redis, migrations, auth/key-vault/S3 test env, seed user — but it is owned by this
skill and starts the repo's dev server (`pnpm run dev:next` / `bun run dev`),
not `e2e/scripts/setup.ts --start`. The script hard-blocks when root `.env`
exists, so it cannot accidentally override a user's local config. When `.env`
exists, do not call any `init-dev-env.sh` subcommand.

Decision flow:

```bash
if [[ -f .env ]]; then
  bun run dev
else
  ./.agents/skills/agent-testing/scripts/init-dev-env.sh setup-db
  ./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user
  ./.agents/skills/agent-testing/scripts/init-dev-env.sh dev
fi
```

Bootstrap flow when no `.env` exists:

```bash
# From repo root. Managed Postgres/Redis flow requires Docker Desktop.
./.agents/skills/agent-testing/scripts/init-dev-env.sh setup-db
./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user
./.agents/skills/agent-testing/scripts/init-dev-env.sh dev
```

If using an existing Postgres instead of the managed Docker DB, set
`DATABASE_URL` and `REDIS_URL`, then skip `setup-db`:

```bash
DATABASE_URL=postgresql://... REDIS_URL=redis://... ./.agents/skills/agent-testing/scripts/init-dev-env.sh migrate
DATABASE_URL=postgresql://... REDIS_URL=redis://... ./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user
DATABASE_URL=postgresql://... REDIS_URL=redis://... ./.agents/skills/agent-testing/scripts/init-dev-env.sh dev
```

For backend-only checks, `dev-next` is available, but Web smoke needs the
full-stack `dev` command so Next can proxy the SPA HTML from Vite:

```bash
./.agents/skills/agent-testing/scripts/init-dev-env.sh dev-next
```

Useful subcommands:

```bash
./.agents/skills/agent-testing/scripts/init-dev-env.sh env       # print exports
./.agents/skills/agent-testing/scripts/init-dev-env.sh write     # write .records/env/agent-testing-dev.env
./.agents/skills/agent-testing/scripts/init-dev-env.sh migrate   # migrations only
./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user # seed user + CLI API key
./.agents/skills/agent-testing/scripts/init-dev-env.sh qstash    # local QStash for workflow paths
./.agents/skills/agent-testing/scripts/init-dev-env.sh clean-db  # remove managed DB container
```

Default script env:

- `APP_URL=http://localhost:3010`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres`
- `DATABASE_DRIVER=node`
- `AGENT_RUNTIME_MODE=queue` so backend-only agent runtime checks use the
  same queued execution path as production
- `REDIS_URL=redis://localhost:6380` for queue-mode agent runtime state
- `FEATURE_FLAGS=-agent_self_iteration` so local smoke does not require QStash
- Local QStash defaults (`QSTASH_URL`, `QSTASH_TOKEN`, signing keys) are exported;
  run `init-dev-env.sh qstash` in a separate terminal when the path under test
  triggers QStash/Workflow.
- `KEY_VAULTS_SECRET`, `AUTH_SECRET`, auth verification off
- S3 mock vars
- Managed DB container: `lobehub-agent-testing-postgres`
- Managed Redis container: `lobehub-agent-testing-redis`

`seed-user` creates `agent-testing@lobehub.com` / `TestPassword123!` with
onboarding already completed, plus a local API key in
`.records/env/agent-testing-cli.env` for CLI automation. When running Cucumber
against this dev server, pass the same script env into the test process too;
Cucumber has its own `BeforeAll` seed path and it must see `DATABASE_URL`
instead of silently skipping setup:

```bash
cd e2e
# Only in the no-.env branch.
eval "$(../.agents/skills/agent-testing/scripts/init-dev-env.sh env)"
BASE_URL=http://localhost:3010 HEADLESS=true bun run test:smoke
```

### 0.4 Auth is green for the selected surface

**Auth is the gate for automated testing, but the gate is surface-scoped.**
Pick the intended surface first when it is already clear from the task, then
check only that surface. Do not block a Web test on CLI device-code auth or an
Electron login state unless the test spans those surfaces.

```bash
./.agents/skills/agent-testing/scripts/setup-auth.sh status --surface web
```

Use `status` with no `--surface` only for cross-surface test plans.

| Surface  | Mechanism                                     | One-key path             | Standard check                            |
| -------- | --------------------------------------------- | ------------------------ | ----------------------------------------- |
| CLI      | Seeded API key, device-code fallback          | `setup-auth.sh cli-seed` | `setup-auth.sh status --surface cli`      |
| Web      | Seeded better-auth login into `agent-browser` | `setup-auth.sh web-seed` | `setup-auth.sh status --surface web`      |
| Electron | App's own persistent login state              | Log in once in the app   | `setup-auth.sh status --surface electron` |
| Bot      | Native apps already logged in                 | —                        | per-platform screenshot                   |

Login-state checks are standardized — do NOT hand-roll `window.__LOBE_STORES`
eval snippets; use `scripts/app-probe.sh auth` (returns `{ isSignedIn, userId }`,
works for Electron CDP and web sessions via `AB_TARGET`).

For Web tests, the test surface is always `agent-browser --session lobehub-dev`.
Use `setup-auth.sh web-seed` first in the seeded local env. The user's normal
Chrome is only a source for copying the Cookie header when seed auth is not
available or `status --surface web` still fails. If Chrome is already logged in,
do not open a login page; verify agent-browser first, then request the Network
`Cookie:` header only if that verification fails. Full background and failure modes:
[references/auth.md](./references/auth.md).

## Step 1 — Pick the surface by change scope

| Change scope                                            | Default surface                      | Why                                                               | Guide                              |
| ------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- | ---------------------------------- |
| **Backend** (TRPC router / service / model / migration) | **CLI**                              | Fastest loop, text-assertable output, zero UI flakiness           | [cli/index.md](./cli/index.md)     |
| **Pure frontend** (components, store, styles, UX)       | **Electron** (agent-browser + CDP)   | Primary product shape; `__LOBE_STORES` state introspection        | [ui/electron.md](./ui/electron.md) |
| **Full-stack** (new API + UI consuming it)              | **Web** (browser + local dev server) | One surface where network requests and UI are observable together | [ui/web.md](./ui/web.md)           |
| **Bot channels** (Discord / WeChat / Lark / …)          | Native app via osascript / bridge    | Only way to exercise the real channel end-to-end                  | `bot/<platform>/index.md`          |

Escalate, don't duplicate: verify a backend change with the CLI first; only add
a UI pass when the change actually affects the UI.

### Environment support (local macOS vs cloud Linux)

The decisive constraint per surface is **how evidence (screenshots) is
captured**: CDP-based capture (`agent-browser screenshot`) renders from the
browser engine and needs no real display; OS-level capture (`screencapture`,
osascript) is macOS-only.

| Surface  | macOS (local) | Linux / cloud (headless)                                  | Screenshot mechanism                                   |
| -------- | ------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| CLI      | ✅            | ✅                                                        | n/a — text output                                      |
| Web      | ✅            | ✅ headless Chromium works natively                       | CDP — no display needed                                |
| Electron | ✅            | ⚠️ runs, but needs a display server: wrap with `xvfb-run` | CDP works under Xvfb; `capture-app-window.sh` does NOT |
| Bot      | ✅            | ❌ osascript + native apps are macOS-only                 | macOS `screencapture` only                             |

When a test must stay cloud-portable, prefer CDP-based evidence over
OS-level capture wherever both exist.

### Bot platforms

| Platform      | Guide                                            | Quick switcher        |
| ------------- | ------------------------------------------------ | --------------------- |
| Discord       | [bot/discord/index.md](./bot/discord/index.md)   | `Cmd+K`               |
| Slack         | [bot/slack/index.md](./bot/slack/index.md)       | `Cmd+K`               |
| Telegram      | [bot/telegram/index.md](./bot/telegram/index.md) | `Cmd+F`               |
| WeChat / 微信 | [bot/wechat/index.md](./bot/wechat/index.md)     | `Cmd+F`               |
| Lark / 飞书   | [bot/lark/index.md](./bot/lark/index.md)         | `Cmd+K`               |
| QQ            | [bot/qq/index.md](./bot/qq/index.md)             | `Cmd+F`               |
| iMessage      | [bot/imessage/index.md](./bot/imessage/index.md) | bridge (no osascript) |

Each platform folder contains an `index.md` (activation, navigation,
send-message, verification snippets) and a `test-<platform>-bot.sh` script
sharing the interface:

```bash
./.agents/skills/agent-testing/bot/<platform>/test-<platform>-bot.sh <channel_or_contact> <message> [wait_seconds] [screenshot_path]
```

New to osascript automation? Read
[references/osascript.md](./references/osascript.md) first — it is a general
macOS-automation asset (activate, type, paste, screenshot, accessibility reads,
gotchas), not bot-specific.

## Step 2 — Run

Surface guides above carry the detailed workflows. Shared infrastructure:

| Need                                 | Where                                                                |
| ------------------------------------ | -------------------------------------------------------------------- |
| Start / restart the local dev server | [references/dev-server.md](./references/dev-server.md)               |
| `agent-browser` command reference    | [references/agent-browser.md](./references/agent-browser.md)         |
| osascript patterns (general macOS)   | [references/osascript.md](./references/osascript.md)                 |
| Agent gateway probing                | [references/agent-gateway.md](./references/agent-gateway.md)         |
| Screen recording                     | [references/record-app-screen.md](./references/record-app-screen.md) |

### Scripts

All under `.agents/skills/agent-testing/scripts/`:

| Script                    | Usage                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| `test-env.sh`             | Print/export the resolved local test env and ports                           |
| `setup-auth.sh`           | One-stop auth setup & status check (`status` / `cli` / `web`)                |
| `init-dev-env.sh`         | Self-contained local dev env (`setup-db` / `seed-user` / `dev-next` / `dev`) |
| `app-probe.sh`            | LobeHub app probes: `auth` / `route` / `ops` / `goto <path>` / `errors`      |
| `record-gif.sh`           | Frame-sequence → GIF for time-based behavior (streaming, timers, animations) |
| `report-init.sh`          | Scaffold a structured test report (Step 3)                                   |
| `electron-dev.sh`         | Manage Electron dev env (start/stop/status/restart, CDP 9222)                |
| `capture-app-window.sh`   | Screenshot a specific app window (general; used by bot tests)                |
| `record-app-screen.sh`    | Record app screen (video + periodic screenshots)                             |
| `record-electron-demo.sh` | Record Electron app demo with ffmpeg                                         |
| `agent-gateway/`          | Gateway probe / dump / analyze tools                                         |

`app-probe.sh` is the LobeHub-specific fast path into app state — auth check,
current route, running operations, and `goto <path>` quick navigation
(`/agent/<agentId>/<topicId>`, `/task/<taskId>`, `/settings`, …) so a test can
jump straight to the state under test instead of clicking through the UI. See
[ui/electron.md](./ui/electron.md#lobehub-probes--quick-navigation) for usage.

## Step 3 — Structured report (mandatory deliverable)

Every automated test session ends with a structured, evidence-backed report —
not a chat-only summary. Scaffold it up front and fill it as you test:

```bash
DIR=$(./.agents/skills/agent-testing/scripts/report-init.sh my-feature "Verify my feature")
# ... test, saving screenshots / CLI transcripts into $DIR/assets/ ...
# fill $DIR/result.json (scenario, context, cases[], summary.conclusion) — the report;
# $DIR/report.md holds only the narrative tail (跟进 / 本轮验证 / 评分)
```

Reports live in `.records/reports/<timestamp>-<slug>/` (gitignored): `result.json`
(the structured report — scenario/context/cases/summary), `report.md` (narrative
tail), `assets/` (evidence). Format spec and evidence rules:
[references/report.md](./references/report.md).

Two hard rules worth front-loading:

- **Report language = the user's conversation language.** Write `report.md` and
  every human-facing string in `result.json` (case `name`/`observation`,
  `summary.conclusion`, scope `focus`/`entry`) in the language the user is
  conversing in. `result.json` keys/status values stay English.
- **`result.json` is the report; the verify page renders it.** Each tested
  behavior is one entry in `cases[]` (`{ name, result, observation, evidence }`);
  the published `/verify/<id>` page builds the scope header from
  `scenario`+`context`, the check list from `cases[]`, and the headline verdict
  from `summary.conclusion`. So do NOT hand-build a 用例 table or a 范围 block in
  `report.md` — they double up on the page. `report.md` is the narrative tail
  only (跟进 / 本轮验证 / 评分).
- **Visual evidence must render inline.** Screenshots and GIFs in `report.md`
  must use Markdown image syntax like `![case 1](assets/case1.png)`. Do not
  use bare file paths, Markdown links, or local file links as the primary
  visual evidence; those make the report unreadable without opening each asset.
- **Final replies must include visual evidence links.** When a run includes UI
  screenshots or GIFs, include the report directory and the most important
  visual artifacts in the final chat response. Each item must include a stable
  label, an evidence caption describing the observed UI outcome, and a
  repo-relative path, for example:
  `[Image #1 - error toast shows provider auth failure](<report-dir>/assets/foo.png)`.
  Use repo-relative paths, not absolute paths.
- **Time-based behavior needs a GIF, not a screenshot.** If a case asserts
  change over time (streaming output, a ticking timer, loading states,
  animations), record it with `scripts/record-gif.sh` and embed the GIF —
  a static screenshot cannot prove the behavior.

## Step 4 — Publish to LobeHub (mandatory)

The local report under `.records/reports/` is the working artifact; the
**deliverable is the report opened in LobeHub**. Do not stop at local files —
push the session up with the CLI so the user (and later reviewers) can open it
at a stable URL with the evidence rendered inline.

**Publish targets PRODUCTION (`https://app.lobehub.com`), not the local dev
server.** The product-under-test usually runs against a local env whose seeded
CLI profile (`.records/env/agent-testing-cli.env`) points the CLI at
`http://localhost:3010` via `LOBEHUB_SERVER` / `LOBE_API_KEY` /
`LOBEHUB_CLI_HOME=.lobehub-dev`. Those overrides are for _running_ the backend
test — they are wrong for _publishing_: a localhost run yields a URL nobody else
can open, and a local env's stub S3 makes file-evidence uploads fail
(`fetch failed`). The deliverable must live on production, with the user's real
login (`~/.lobehub`) and real storage.

So run the publish in a CLEAN environment that strips the local dev overrides,
which falls back to the CLI defaults (`https://app.lobehub.com` + `~/.lobehub`):

```bash
# Publish to PRODUCTION — strip the local dev CLI overrides so `lh` uses its
# production defaults (app.lobehub.com + the user's real ~/.lobehub login).
env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME \
  lh verify ingest-report "$DIR" --source agent-testing --open --json
```

Production auth is the user's own device-code login, not the seeded local key.
Verify it first in the same clean env; if it returns "No authentication found",
have the user log in (the flow prints a URL + code to authorize in the browser),
then re-run the publish:

```bash
env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME lh verify run list --json # [] = authed
env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME lh login                  # only if not authed
```

`verify ingest-report` reads `$DIR` and, in one call, creates a standalone
verification session and uploads everything:

- `result.json.cases[]` → one check result each (verdict + key observation)
- each case's `evidence` file(s) → uploaded to storage and attached to that result
- `report.md` → the session's full report body, plus the `summary` stats

It prints the `verifyRunId` and, with `--open`, the in-app path
`/verify/<verifyRunId>` — the report viewer (verdict, stats, every check, and the
inline screenshot/text evidence). On production that resolves to
`https://app.lobehub.com/verify/<verifyRunId>`. **Include that full production
link in the final chat reply** alongside the local report dir.

Notes:

- `result.json` cases use `{ id?, name, result, observation?, evidence? }`;
  `evidence` is a path (or array of paths) relative to `$DIR`. `result`/`verdict`
  map onto `passed | failed | uncertain` (pass/ok→passed, fail/error→failed,
  else→uncertain).
- Need finer control? The same data is reachable through the atomic commands —
  `verify run create`, `verify result ingest`, `verify evidence upload`
  (`--file` or `--content`), `verify report upsert` — so a session can be built
  incrementally instead of from a report dir.
- File evidence uploads through the app's storage (S3/R2). Against a stub or
  unreachable bucket (common in local dev) the file PUT fails; `ingest-report`
  logs a warning, **skips that one artifact**, and still finishes the session,
  results, and report. So the published session is real and openable — but it is
  **missing the skipped evidence**, which is easy to mistake for a complete
  report. If the evidence must appear, publish against an env with real storage
  (e.g. production) or attach it inline with `verify evidence upload --content`.

## Directory map

```
agent-testing/
├── SKILL.md            # this router
├── cli/index.md        # backend verification via the LobeHub CLI
├── ui/electron.md      # pure-frontend verification in the desktop app
├── ui/web.md           # full-stack verification in the browser
├── bot/<platform>/     # bot-channel verification (osascript / bridge)
├── references/         # shared knowledge: auth, dev-server, agent-browser, osascript, report
└── scripts/            # setup-auth, report-init, electron-dev, capture, recording, gateway
```

## Gotchas

- agent-browser: see [references/agent-browser.md](./references/agent-browser.md#gotchas)
- Electron: see [ui/electron.md](./ui/electron.md#electron-gotchas)
- osascript: see [references/osascript.md](./references/osascript.md#gotchas)
