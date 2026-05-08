# 🚀 LobeHub Release (20260427)

**Hotfix Scope:** Agent topic-switching regression — stale chat state on agent change

> Clears residual topic state when navigating between agents and restores blank-canvas behavior on agent switch.

## 🐛 What's Fixed

- **Stale topic on agent switch** — Switching from `/agent/agt_A/tpc_X` to `/agent/agt_B` no longer leaves the previous topic's messages on screen, and _Start new topic_ responds again. (#14231)
- **Header & sidebar consistency** — Conversation header now shows the active subtopic's title, and the sidebar keeps the parent topic's thread list expanded while a thread is open.

## ⚙️ Upgrade

- Self-hosted: pull the new image and restart. No schema or env changes.
- Cloud: applied automatically.

## 👥 Owner

@{pr-author}

> **Note for Claude**: Replace `{pr-author}` with the actual PR author. Retrieve via `gh pr view <number> --json author --jq '.author.login'`. Do not hardcode a username.
