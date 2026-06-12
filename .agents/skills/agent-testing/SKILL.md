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
four-step contract:

```
Step 0: Env + Auth  →  Step 1: Pick surface  →  Step 2: Run  →  Step 3: Structured report
```

## Step 0 — Environment setup + auth check (mandatory)

Step 0 is about getting the environment ready: **dependencies are healthy**
and **auth is green**. A test run that dies halfway on a missing dependency or
a login wall wastes the whole session — clear both gates BEFORE writing a
single test step.

### 0.1 Dependencies are installed — root AND standalone apps

The root pnpm workspace does **NOT** cover every app: `pnpm-workspace.yaml`
lists `packages/**`, `e2e`, `apps/server`, and only `apps/desktop/src/main` —
**`apps/desktop` and `apps/cli` are standalone**, each keeping its own
`node_modules` with its own links into `packages/`. A root install does not
refresh them, so install in every app the test will touch:

```bash
pnpm install                      # root workspace
cd apps/desktop && pnpm install   # Electron surface
cd apps/cli && pnpm install       # CLI surface
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

### 0.3 Auth is green

**Auth is the gate for all automated testing.**

```bash
./.agents/skills/agent-testing/scripts/setup-auth.sh status
```

| Surface  | Mechanism                                         | One-key path                   | Standard check                 |
| -------- | ------------------------------------------------- | ------------------------------ | ------------------------------ |
| CLI      | OIDC Device Code Flow (`apps/cli/.lobehub-dev`)   | `setup-auth.sh cli`            | `setup-auth.sh status`         |
| Web      | better-auth cookie injection into `agent-browser` | `pbpaste \| setup-auth.sh web` | `setup-auth.sh web-verify`     |
| Electron | App's own persistent login state                  | Log in once in the app         | `app-probe.sh auth`            |
| Bot      | Native apps already logged in                     | —                              | per-platform screenshot        |

Login-state checks are standardized — do NOT hand-roll `window.__LOBE_STORES`
eval snippets; use `scripts/app-probe.sh auth` (returns `{ isSignedIn, userId }`,
works for Electron CDP and web sessions via `AB_TARGET`).

If `status` is not all green, fix auth first (the steps that need a human must be
requested from the user explicitly). Full background and failure modes:
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

| Script                    | Usage                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| `setup-auth.sh`           | One-stop auth setup & status check (`status` / `cli` / `web`)                  |
| `app-probe.sh`            | LobeHub app probes: `auth` / `route` / `ops` / `goto <path>` / `errors`        |
| `record-gif.sh`           | Frame-sequence → GIF for time-based behavior (streaming, timers, animations)   |
| `report-init.sh`          | Scaffold a structured test report (Step 3)                                     |
| `electron-dev.sh`         | Manage Electron dev env (start/stop/status/restart, CDP 9222)                  |
| `capture-app-window.sh`   | Screenshot a specific app window (general; used by bot tests)                  |
| `record-app-screen.sh`    | Record app screen (video + periodic screenshots)                               |
| `record-electron-demo.sh` | Record Electron app demo with ffmpeg                                           |
| `agent-gateway/`          | Gateway probe / dump / analyze tools                                           |

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
# fill $DIR/report.md (case table, embedded evidence, verdict) and $DIR/result.json
```

Reports live in `.records/reports/<timestamp>-<slug>/` (gitignored): `report.md`
(human-readable, with embedded screenshots), `result.json` (machine-readable
pass/fail + score), `assets/` (evidence). Format spec and evidence rules:
[references/report.md](./references/report.md).

Two hard rules worth front-loading:

- **Report language = the user's conversation language.** Write the ENTIRE
  `report.md` (headings included) in the language the user is conversing in —
  no mixed English. `result.json` keys/status values stay English.
- **Time-based behavior needs a GIF, not a screenshot.** If a case asserts
  change over time (streaming output, a ticking timer, loading states,
  animations), record it with `scripts/record-gif.sh` and embed the GIF —
  a static screenshot cannot prove the behavior.

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
