# Environment preflight — 2026-09-28

**Historical first-pass snapshot. Continued investigation resolved the dependency/service/auth gaps below. Use [environment-ready.md](environment-ready.md) for current state, provenance, remaining gaps and restart commands.**

Observed in D's own worktree; no shared services changed.

| Item               | Observed                                                                                                                                     | Gap / next action                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree           | independent `c830e366…`; `feat/agent-hook-integration-docs`, F `66af6210`                                                                    | coordinator's final integrated base required for product execution                                                                     |
| Runtime            | Bun 1.4.2, pnpm 12.4.1; Node shim unselected by default                                                                                      | use process-local `ASDF_NODEJS_VERSION=24.21.0`, no global config change                                                               |
| Dependencies       | no root or standalone CLI node\_modules, no root `.env`                                                                                      | install isolated workspace graph and standalone CLI if source CLI used; don't symlink another live worktree                            |
| CLI                | global 0.0.55 lacks doctor; cached `pnpm --package=@lobehub/cli@0.0.59 dlx lh` doctor works                                                  | cached CLI usable for offline diagnosis without replacing global binary                                                                |
| Login              | stored login locally decoded issuer is production OIDC, nonexpired; personal-scope read-only acceptance list succeeded                       | production read access available; isolated local seeded login still absent; no interactive login or profile change                     |
| DB                 | Docker reachable; running Postgres containers belong to TITU only                                                                            | do not use/modify them; create D-specific DB/Redis using existing helper overrides                                                     |
| Services           | resolved 3010/9876 and probed 5433/6380/8080/29000 all connection refused                                                                    | no LobeHub app/DB/Redis/QStash/S3 health; separate container isolation and dynamic app ports required                                  |
| Env                | DATABASE\_URL/REDIS\_URL/QSTASH\_TOKEN/QSTASH\_URL and checked OpenAI/Anthropic keys absent from this process                                | no known configured real LLM/QStash target; absence here does not prove user has no credentials elsewhere                              |
| Device             | production device list read succeeded: one device, online:false                                                                              | no online device now; no local app/gateway pairing for this worktree; do not treat production enrollment as local forwarding readiness |
| Browser            | agent-browser absent on PATH; Chrome CDP listener exists and is user-owned                                                                   | install/use dedicated automation session after local auth; do not take over user's CDP/browser                                         |
| Receiver           | 14 response fixtures, 16 hook factory; initial 12-fixture timeout/redaction smoke passed; revised boundary fixtures rechecked in final smoke | this is harness-only; full execAgent import/run is blocked by dependencies and final baseline                                          |
| Provider catalogue | authenticated production list readable: 86 catalogue entries, 2 enabled                                                                      | no inference performed and no isolated test key established; enabled is not proof of model availability                                |
| Existing helpers   | init-dev-env, setup-auth, app-probe, llm-stub, gateway helpers available                                                                     | reuse; stub is not real LLM evidence; source CLI install separate from workspace                                                       |

## Commands

Immediate read-only/self-contained checks:

```bash
ASDF_NODEJS_VERSION=24.21.0 pnpm --package=@lobehub/cli@0.0.59 dlx lh doctor --offline --json
.agents/acceptance/scripts/test-env.sh
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
bun .agents/acceptance/scenarios/agent-hooks/self-check.ts
```

The existing helper supports isolated container names. After dependencies and final baseline are ready, run from D only (ports verified free before starting; helper allocates app ports). Do not run against a future `.env` file; follow PROJECT.md's existing-env path instead.

```bash
export ASDF_NODEJS_VERSION=24.21.0
export DB_CONTAINER=lobehub-hooks-d-postgres REDIS_CONTAINER=lobehub-hooks-d-redis
export DB_PORT=5433 REDIS_PORT=6380
pnpm install
.agents/acceptance/scripts/init-dev-env.sh setup-db
.agents/acceptance/scripts/init-dev-env.sh seed-user
# separate owned terminals, from this worktree:
.agents/acceptance/scripts/init-dev-env.sh qstash
.agents/acceptance/scripts/init-dev-env.sh s3
.agents/acceptance/scripts/init-dev-env.sh preflight
.agents/acceptance/scripts/init-dev-env.sh dev
```

After boot, re-read ports with test-env.sh, assert migrated tables/seed user, perform real DB query/Redis ping and queue-to-receiver delivery. Use setup-auth.sh web-seed and a unique `agent-browser` session for UI; confirm isolated identity with app-probe. Real model credentials need a known test provider/account and device needs a matching local gateway/identity; no production credentials are repointed. Remote QStash needs a reachable receiver URL and credentials for that service, not merely a token-shaped value.

The documented setup commands are preparation instructions, **not executed successes**. Full root dependency installation and isolated DB creation are deferred to the final baseline to avoid establishing a large stale build. This is an environment preparation gap, not a credential blocker. Scoped `bun run check --lint` was attempted and exited 2 because `node_modules/.bin/eslint` is absent; the normal commit hook also failed because `lint-staged` is absent. The preparation-only checkpoint uses `HUSKY=0` after recording those gaps; it is not a quality-gate pass. No full type-check was claimed. None of the current missing-service observations justify claiming product failure or acceptance success.
