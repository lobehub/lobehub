# DB Schema Migration Changelog Example

A changelog reference for database migration release PR bodies.

---

This release includes a **database schema migration** involving **5 new tables** for the Agent Evaluation Benchmark system.

### Migration: Add Agent Evaluation Benchmark Tables

- Added 5 new tables: `agent_eval_benchmarks`, `agent_eval_datasets`, `agent_eval_records`, `agent_eval_runs`, `agent_eval_run_topics`

### Notes for Self-hosted Users

- The migration runs automatically on application startup
- No manual intervention required

The migration owner: @arvinxx — responsible for this database schema change, reach out for any migration-related issues.
