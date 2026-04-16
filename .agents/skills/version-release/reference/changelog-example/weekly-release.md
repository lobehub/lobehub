# 🚀 LobeHub v2.1.50 (20260420)

**Release Date:** April 20, 2026\
**Since v2026.04.13:** 96 commits · 58 merged PRs · 31 resolved issues · 17 contributors

> This weekly release focuses on reducing friction in everyday agent work: faster model routing, smoother gateway behavior, stronger task continuity, and clearer operator diagnostics when something goes wrong.

---

<<<<<<< HEAD
## ✨ Highlights

- **Gateway Session Recovery** — Agent sessions now recover more reliably after short network interruptions, so long-running tasks continue with less manual retry. (#10121, #10133)
- **Fast Model Routing** — Expanded low-latency routing for priority model tiers, reducing wait time in high-frequency generation workflows. (#10102, #10117)
- **Agent Task Workspace** — Running tasks now remain isolated from main chat state, which keeps primary conversations cleaner while background work progresses. (#10088)
- **Provider Coverage Update** — Added support for new model variants across OpenAI-compatible and regional providers, improving fallback options in production. (#10094, #10109)
- **Desktop Attachment Flow** — File and screenshot attachment behavior is more predictable in desktop sessions, especially for mixed text + media prompts. (#10073)
- **Security Hardening Pass** — Closed multiple input validation gaps in webhook and file-path handling paths. (#10141, #10152)

---

## 🏗️ Core Agent & Architecture

### Agent loop and context handling

- Improved context compaction thresholds to reduce mid-task exits under tight token budgets. (#10079)
- Added better diagnostics for tool-call truncation and recovery behavior during streamed responses. (#10106)
- Refined delegate task activity propagation to improve parent-child task status consistency. (#10098)

### Provider and model behavior

- Unified provider-side timeout handling in fallback chains to reduce false failure classification. (#10097)
- Updated reasoning-model defaults and response normalization for better cross-provider consistency. (#10109)

---

## 📱 Gateway & Platform Integrations
=======
This weekly release includes **82 commits**. The throughline is simple: less friction when moving from idea to execution. Across agent workflows, model coverage, and desktop polish, this release removes several small blockers that used to interrupt momentum.

The result is not one headline feature, but a noticeably smoother week-to-week experience. Teams can evaluate agents with clearer structure, ship richer media flows, and spend less time debugging provider and platform edge cases.

## Agent workflows and media generation

Previously, some agent evaluation and media generation flows still felt fragmented: setup was manual, discoverability was uneven, and switching between topics could interrupt context. This release adds **Agent Benchmark** support and lands the **video generation** path end-to-end, from entry point to generation feedback.

In practice, this means users can discover and run these workflows with fewer detours. Sidebar "new" indicators improve visibility, skeleton loading makes topic switches feel less abrupt, and memory-related controls now behave more predictably under real workload pressure.

We also expanded memory controls with effort and tool-permission configuration, and improved timeout calculation for memory analysis tasks so longer runs fail less often in production-like usage.

## Models and provider coverage

Provider diversity matters most when teams can adopt new models without rewriting glue code every sprint. This release adds **Straico** and updates support for Claude Sonnet 4.6, Gemini 3.1 Pro Preview, Qwen3.5, Grok Imagine (`grok-imagine-image`), and MiniMax 2.5.

Use these updates to:

- route requests to newly available providers
- test newer model families without custom patching
- keep model parameters and related i18n copy aligned across providers

This keeps model exploration practical: faster evaluation loops, fewer adaptation surprises, and cleaner cross-provider behavior.

## Desktop and platform polish

Desktop receives a set of quality-of-life upgrades that reduce "death by a thousand cuts" moments. We integrated `electron-liquid-glass` for macOS Tahoe and improved DMG background assets and packaging flow for more consistent release output.

The desktop editor now supports image upload from the file picker, which shortens everyday authoring steps and removes one more reason to switch tools mid-task.

## Improvements and fixes

- Fixed multiple video pipeline issues across precharge refund handling, webhook token verification, pricing parameter usage, asset cleanup, and type safety.
- Fixed path traversal risk in `sanitizeFileName` and added corresponding unit tests.
- Fixed MCP media URL generation when `APP_URL` was duplicated in output paths.
- Fixed Qwen3 embedding failures caused by batch-size limits.
- Fixed several UI interaction issues, including mobile header agent selector/topic count, ChatInput scrolling behavior, and tooltip stacking context.
- Fixed missing `@napi-rs/canvas` native bindings in Docker standalone builds.
- Improved GitHub Copilot authentication retry behavior and response error handling in edge cases.

## Credits
>>>>>>> origin/main

- Gateway now drains in-flight events more safely before restart, reducing duplicate notification bursts. (#10125)
- Discord and Slack adapters received retry/backoff tuning for unstable webhook windows. (#10091, #10119)
- WeCom callback-mode message state persistence now uses safer atomic updates. (#10114)

---

## 🖥️ CLI & User Experience

- Improved slash command discoverability in CLI and gateway contexts with clearer hint messages. (#10086)
- `/model` switching feedback now returns clearer success/failure states in cross-platform chats. (#10108)
- Setup flow now warns earlier about missing provider credentials in first-run scenarios. (#10115)

---

## 🔧 Tooling

- MCP registration flow now validates duplicate tool names before activation, reducing runtime conflicts. (#10093)
- Browser tooling improved stale-session cleanup to prevent orphaned local resources. (#10112)

---

## 🔒 Security & Reliability

- **Security:** Hardened path sanitization for uploaded assets and webhook callback validation. (#10141, #10152)
- **Reliability:** Reduced empty-response retry storms by refining retry-classification conditions. (#10130)
- **Reliability:** Improved timeout defaults for long-running background processes in constrained environments. (#10122)

---

## 👥 Contributors

**58 merged PRs** from **17 contributors** across **96 commits**.

### Community Contributors

- @alice-example - Gateway recovery and retry improvements
- @bob-example - Provider fallback normalization
- @charlie-example - Desktop media attachment flow
- @dora-example - Webhook validation hardening

---

**Full Changelog**: v2026.04.13...v2026.04.20
