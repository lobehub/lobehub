# 🚀 LobeHub v2.1.50 (20260420)

**Release Date:** April 20, 2026\
**Since v2026.04.13:** 96 commits · 58 merged PRs · 31 resolved issues · 17 contributors

> This weekly release focuses on reducing friction in everyday agent work: faster model routing, smoother gateway behavior, stronger task continuity, and clearer operator diagnostics when something goes wrong.

---

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
