# 🚀 LobeHub v2.1.50 (20260416)

**Release Date:** April 20, 2026\
**Migration Scope:** Agent benchmark data model bootstrap (5 new tables, 2 new indexes)

> This release introduces a schema foundation for benchmark execution and reporting, so agent evaluation data is stored as a complete lifecycle instead of fragmented records.

---

## ✨ Highlights

- **Benchmark Lifecycle Schema** — Added a relational model that tracks benchmark setup, runs, per-topic execution, and record outputs end-to-end.
- **Queryability Upgrade** — Added indexes for run status and benchmark-topic joins, improving operational queries in dashboard and debugging workflows.
- **Safer Operator Rollout** — Migration is startup-driven and backward-compatible with existing non-benchmark chat workflows.

---

## 🗄️ Migration Overview

Added tables:

- `agent_eval_benchmarks`
- `agent_eval_datasets`
- `agent_eval_runs`
- `agent_eval_run_topics`
- `agent_eval_records`

Added indexes:

- `idx_agent_eval_runs_status_created_at`
- `idx_agent_eval_run_topics_run_id_topic_id`

These additions close a previous gap where benchmark data existed in partial forms but lacked a stable relational backbone for auditing and historical analysis.

---

## ⚙️ Operator Notes

- Migration runs automatically on application startup.
- No manual SQL is required in standard deployment paths.
- Schedule rollout in a low-traffic window and take a backup snapshot before deployment.
- If migration fails, do not retry repeatedly; inspect migration logs and lock state first.

---

## 🔒 Reliability & Risk

- Existing chat/session paths are unaffected unless benchmark features are enabled.
- Migration is additive (new tables/indexes only), minimizing downgrade risk to existing entities.
- Rollback should follow your standard DB restore or migration rollback policy if your environment requires strict reversibility.

---

## 👥 Owner

Migration owner: @{pr-author}

The migration owner is responsible for rollout follow-up and incident handling for this schema change.

> **Note for Claude**: Replace `{pr-author}` with the actual PR author. Retrieve via `gh pr view <number> --json author --jq '.author.login'` or from commit metadata. Do not hardcode a username.
