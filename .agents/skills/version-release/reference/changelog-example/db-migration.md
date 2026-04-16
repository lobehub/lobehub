# DB Schema Migration Changelog Example

A changelog reference for database migration release PR bodies.

---

This release includes a **database schema migration** for Agent Evaluation Benchmark. We are adding **5 new tables** so benchmark setup, runs, and run-topic records can be stored in a complete and queryable structure.

## Migration overview

Previously, benchmark-related data lacked a full lifecycle model, which made it harder to track evaluation flow from dataset to run results. This migration introduces the missing relational layer so benchmark configuration, execution, and analysis records stay connected.

In practical terms, this reduces ambiguity for downstream features and gives operators a cleaner foundation for troubleshooting and reporting.

Added tables:

- `agent_eval_benchmarks`
- `agent_eval_datasets`
- `agent_eval_records`
- `agent_eval_runs`
- `agent_eval_run_topics`

## Notes for self-hosted users

- Migration runs automatically during app startup.
- No manual SQL action is required in standard deployments.
- As with any schema release, we still recommend database backup and rollout during a low-traffic window.

The migration owner: @{pr-author} — responsible for this database schema change, reach out for any migration-related issues.

> **Note for Claude**: Replace `{pr-author}` with the actual PR author. Retrieve via `gh pr view <number> --json author --jq '.author.login'` or `git log` commit author. Do NOT hardcode a username.
