---
name: run-eval-harbor
description: 'Run and diagnose existing Harbor evaluations against this repository local production LobeHub harness. Use for eval infrastructure, preflight, lh CLI injection, Harbor smoke or job runs, resume, and failure triage. Excludes authoring Harbor tasks and product acceptance.'
---

# Run Eval Harbor

Run existing Harbor evaluations against the isolated infrastructure in
`docker-compose/eval/` and a production LobeHub server from this checkout. Use
`create-task` to author or grade tasks and `acceptance` for product acceptance.

## Guardrails

- Run LobeHub on port `3210` with `bun run start`; never target a dev server or
  port `3010`.
- Compose owns infrastructure and initialization tasks. LobeHub stays on the
  host.
- Create `docker-compose/eval/.env` from `.env.example` only when absent. Before
  starting LobeHub, ask for a nonempty `DEEPSEEK_API_KEY`; never invent, print,
  overwrite, or commit secrets.
- LobeHub uses localhost service URLs. Harbor containers use Docker-reachable
  host URLs. Never interchange them.
- Preflight is read-only. Stop on a nonzero exit instead of mutating data,
  credentials, or server state to force a pass.
- Do not run a model-backed Harbor job without an explicit user request.
- `scripts/run-smoke.sh` is the harness acceptance check. Health endpoints alone
  do not prove CLI login, gateways, QStash, or a real LLM response.

## Run

For a cold start, external eval repository, resume, or failure investigation,
read [references/runbook.md](references/runbook.md).

1. Bootstrap infrastructure, migrations, the fixed eval user, and its CLI key:

   ```bash
   bash .agents/skills/run-eval-harbor/scripts/bootstrap.sh
   ```

2. Build stale or missing LobeHub and CLI outputs:

   ```bash
   bun --env-file=docker-compose/eval/.env run build
   pnpm --dir apps/cli build
   ```

3. Start LobeHub in a persistent terminal and wait for
   `http://localhost:3210/api/version`:

   ```bash
   bash .agents/skills/run-eval-harbor/scripts/server.sh
   ```

4. Run preflight, optionally with the external eval repository, and stop on any
   failure:

   ```bash
   bash .agents/skills/run-eval-harbor/scripts/preflight.sh
   bash .agents/skills/run-eval-harbor/scripts/preflight.sh /absolute/eval/repo
   ```

5. When validating this harness, run its complete smoke and inspect the job and
   trial artifacts before reporting success:

   ```bash
   bash .agents/skills/run-eval-harbor/scripts/run-smoke.sh
   ```

Use an external eval repository's own command for its tasks and resumes.

## Diagnose

- PostgreSQL, Redis, RustFS, QStash, or Compose state: eval infrastructure.
- Port `3210`, migrations, API-key auth, or `/api/version`: LobeHub.
- Ports `8787`/`8788`, gateway health, or service tokens: gateway.
- Docker-only connectivity: bridge address, published port, or host firewall.
- CLI upload/install: `LH_CLI_SOURCE` or `apps/cli/dist`.
- Reward/verifier behavior: the Harbor task; use `create-task` before changing it.

## Stop

```bash
docker compose --env-file docker-compose/eval/.env \
  -f docker-compose/eval/docker-compose.yml down
```

Do not add `-v` unless the user explicitly asks to discard eval data.
