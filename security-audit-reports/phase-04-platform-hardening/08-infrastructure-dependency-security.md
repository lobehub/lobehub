# Infrastructure, Dependency & Deployment Security Audit

| Field              | Value                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **Plane**          | [AICO-109](https://plane.panafor.com/panaforai/browse/AICO-109/)                          |
| **GitHub**         | [#243](https://github.com/Panafor-Ai-Team/Aico/issues/243)                                |
| **Phase**          | Phase 4 — Infrastructure, Monitoring & Final Hardening                                    |
| **Finding prefix** | INFRA-001 …                                                                               |
| **Audit date**     | 2026-08-11                                                                                |
| **Method**         | Static review of Docker/compose/CI + source regression tests; dependency CVE scan blocked |
| **Scope**          | Dependencies, Docker, CI/CD, env isolation, production exposure, DB privileges            |

---

## 1. Executive summary

Aico’s main production [`Dockerfile`](../../Dockerfile) already runs as non-root `nextjs`, and the control-plane compose override binds admin UI to loopback. This audit still found **real gaps**: lockfiles disabled (no reproducible CVE audit), Aico/local images running as root, deploy compose publishing Postgres/Redis to the host, floating `:latest` images, `NODE_TLS_REJECT_UNAUTHORIZED` in the main image, third-party Actions on `@main`, and the app connecting as the Postgres superuser.

**Fixes in this delivery** close INFRA-001…007 (P0/P1 in-repo defaults). INFRA-008…013 remain Open / Accepted Risk with ops follow-up.

| Severity   | Open / Accepted | Fixed |
| ---------- | --------------: | ----: |
| High       |               1 |     5 |
| Medium     |               4 |     1 |
| Low / Info |               2 |     0 |

### Dependency scan note

`pnpm audit` **could not be run** in this workspace: root [`.npmrc`](../../.npmrc) sets `lockfile=false`, and `pnpm-lock.yaml` / `bun.lockb` are gitignored. That is itself **INFRA-008**. Until lockfiles are enabled and committed, CVE inventory must be treated as incomplete.

Aico-specific surface reviewed in addition to upstream LobeHub: [`apps/aico-control-plane`](../../apps/aico-control-plane), [`Dockerfile.prebuilt`](../../Dockerfile.prebuilt), [`docker-compose/deploy/docker-compose.aico*.yml`](../../docker-compose/deploy/).

---

## 2. Checklist (Definition of Done)

| Area                  | Result                                                              |
| --------------------- | ------------------------------------------------------------------- |
| Dependency Scan       | Blocked by lockfile policy — documented INFRA-008; Renovate present |
| CVE review            | Incomplete until lockfile audit possible                            |
| CI/CD review          | Done — INFRA-005, INFRA-009, INFRA-010                              |
| Docker review         | Done — INFRA-001…004, INFRA-011                                     |
| Environment Isolation | Done — INFRA-012                                                    |
| Production Exposure   | Done — INFRA-002, INFRA-006, INFRA-013                              |
| DB Permissions        | Done — INFRA-007 (Accepted Risk short-term)                         |
| Report path           | This file                                                           |

---

## 3. Findings

### INFRA-001 — Aico/local Docker images run as root

| Field                  | Value                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**           | High                                                                                                                                       |
| **Status**             | Fixed                                                                                                                                      |
| **Affected component** | `Dockerfile.prebuilt`, `scripts/docker/Dockerfile.staged`, `apps/aico-control-plane/Dockerfile`                                            |
| **Description**        | Unlike the main multi-stage `Dockerfile` (`USER nextjs`), Aico packaging images had no non-root user, so compromise = full container root. |
| **Attack Scenario**    | RCE in the Node process yields root inside the container and easier breakout / host mount abuse.                                           |
| **Reproduction Steps** | Inspect pre-fix Dockerfiles for missing `USER`.                                                                                            |
| **Impact**             | Elevated blast radius for any app-level RCE.                                                                                               |
| **Recommendation**     | Always run as non-root; keep uid 1001 consistent with main image.                                                                          |
| **Fix**                | Create `nodejs`/`nextjs` and `USER nextjs` in all three Dockerfiles.                                                                       |
| **Retest Result**      | Pass — `src/utils/infra.security.controls.test.ts`                                                                                         |

### INFRA-002 — Deploy compose publishes Postgres and Redis to the host

| Field                  | Value                                                                                                                    |                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **Severity**           | High                                                                                                                     |                                                        |
| **Status**             | Fixed                                                                                                                    |                                                        |
| **Affected component** | `docker-compose/deploy/docker-compose.yml`                                                                               |                                                        |
| **Description**        | Default deploy stack mapped `5432:5432` and `6379:6379`, exposing DB/cache on all host interfaces when Docker publishes. |                                                        |
| **Attack Scenario**    | Attacker on the LAN/internet reaches Postgres/Redis with weak/default passwords from examples.                           |                                                        |
| **Reproduction Steps** | Pre-fix: \`grep -n "5432:5432\\                                                                                          | 6379:6379" docker-compose/deploy/docker-compose.yml\`. |
| **Impact**             | Full data compromise if ports are reachable and credentials weak.                                                        |                                                        |
| **Recommendation**     | Keep DB/Redis on the internal Docker network only; open host ports only for deliberate local debugging.                  |                                                        |
| **Fix**                | Commented out host port publishes with security notes.                                                                   |                                                        |
| **Retest Result**      | Pass — infra security controls test                                                                                      |                                                        |

### INFRA-003 — `.dockerignore` did not exclude `.env`

| Field                  | Value                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Severity**           | High                                                                                                        |
| **Status**             | Fixed                                                                                                       |
| **Affected component** | `.dockerignore`                                                                                             |
| **Description**        | Only `.env.example` was ignored; a `COPY .` (e.g. staged Dockerfile) could bake live secrets into an image. |
| **Attack Scenario**    | Built image leaked from a registry contains production `AUTH_SECRET` / DB password.                         |
| **Impact**             | Credential disclosure via image layers.                                                                     |
| **Fix**                | Ignore `.env`, `.env.*`, keep example allowlist.                                                            |
| **Retest Result**      | Pass — infra security controls test                                                                         |

### INFRA-004 — Production Dockerfile set `NODE_TLS_REJECT_UNAUTHORIZED`

| Field                  | Value                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| **Severity**           | High                                                                                         |
| **Status**             | Fixed                                                                                        |
| **Affected component** | `Dockerfile` runtime `ENV`                                                                   |
| **Description**        | Empty `NODE_TLS_REJECT_UNAUTHORIZED` was present in the final image environment.             |
| **Attack Scenario**    | Mis-set or tooling treating the var as “disable TLS verify” enables MITM against HTTPS deps. |
| **Impact**             | TLS authenticity weakened for outbound HTTPS.                                                |
| **Fix**                | Removed the ENV line; keep OpenSSL CA path via `SSL_CERT_FILE` / `NODE_OPTIONS`.             |
| **Retest Result**      | Pass — infra security controls test                                                          |

### INFRA-005 — CI used `actions-cool/pr-welcome@main`

| Field                  | Value                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | High                                                                                                                         |
| **Status**             | Fixed                                                                                                                        |
| **Affected component** | `.github/workflows/issue-auto-comments.yml` (`pull_request_target`)                                                          |
| **Description**        | Floating `@main` third-party action (same org family as previously tag-poisoned Actions) ran after PR merge with `GH_TOKEN`. |
| **Attack Scenario**    | Compromised action steals repository secrets / tokens from the runner.                                                       |
| **Impact**             | CI/CD credential theft, supply-chain compromise.                                                                             |
| **Fix**                | Replaced with native `gh pr comment` + reaction API using `GH_TOKEN` (no third-party Action).                                |
| **Retest Result**      | Pass — workflow no longer references `actions-cool/pr-welcome`.                                                              |

### INFRA-006 — Concrete passwords in deploy/grafana env examples

| Field                  | Value                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium                                                                                               |
| **Status**             | Fixed                                                                                                |
| **Affected component** | `docker-compose/deploy/.env.example`, `docker-compose/production/grafana/.env.example` (+ zh-CN)     |
| **Description**        | Shared literal `POSTGRES_PASSWORD=uWNZugjBqixf8dxC` and Casdoor client secrets appeared in examples. |
| **Impact**             | Operators may ship “example” credentials to production; password is public in git.                   |
| **Fix**                | Replaced with `YOUR_*` placeholders (aligns with prior DATA-004 Grafana secret work).                |
| **Retest Result**      | Pass — infra security controls test                                                                  |
| **Residual**           | Rotate any live environment that still used the old sample password.                                 |

### INFRA-007 — Application uses Postgres superuser role

| Field                  | Value                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium                                                                                                                          |
| **Status**             | Accepted Risk (short-term)                                                                                                      |
| **Affected component** | Deploy compose `DATABASE_URL=postgresql://postgres:…`                                                                           |
| **Description**        | App runtime authenticates as DB superuser `postgres` — no least-privilege app role.                                             |
| **Attack Scenario**    | SQL injection or stolen `DATABASE_URL` allows DROP DATABASE, role changes, and full cluster control.                            |
| **Impact**             | Maximum database blast radius.                                                                                                  |
| **Recommendation**     | Create role `aico_app` with DML on app schemas only; run migrations as a separate migrator role; update compose `DATABASE_URL`. |
| **Retest Result**      | N/A — documented ops follow-up; not cut over in this PR to avoid breaking self-host installs without a migration playbook.      |

### INFRA-008 — Lockfiles disabled / not committed (blocks CVE audit)

| Field                  | Value                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**           | High                                                                                                                                       |
| **Status**             | Open                                                                                                                                       |
| **Affected component** | `.npmrc` (`lockfile=false`), `.gitignore` (`pnpm-lock.yaml`, `bun.lockb`)                                                                  |
| **Description**        | Supply-chain integrity and `pnpm audit` require a lockfile. Current policy prevents reproducible installs and automated CVE scanning.      |
| **Attack Scenario**    | Silent dependency drift pulls a compromised transitive package on next install.                                                            |
| **Impact**             | Incomplete vulnerability visibility; non-reproducible builds.                                                                              |
| **Recommendation**     | Enable and commit `pnpm-lock.yaml` (or bun lock), set `lockfile=true`, add CI `pnpm audit --prod` / OSV job. Renovate alone is not enough. |
| **Retest Result**      | Fail — `pnpm audit` returns `ERR_PNPM_AUDIT_NO_LOCKFILE` (2026-08-11).                                                                     |

### INFRA-009 — Broad use of tag-pinned (mutable) GitHub Actions

| Field                  | Value                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium                                                                                               |
| **Status**             | Open                                                                                                 |
| **Affected component** | Most workflows under `.github/workflows/`                                                            |
| **Description**        | Actions pinned as `@v1`/`@v6` rather than full commit SHAs; vulnerable to tag-move attacks.          |
| **Recommendation**     | Pin critical third-party Actions by SHA; prefer first-party `actions/*` or `gh` CLI where practical. |
| **Retest Result**      | Open — deferred (large churn); INFRA-005 removes the highest-risk floating ref.                      |

### INFRA-010 — `pull_request_target` workflows

| Field                  | Value                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**           | Medium                                                                                                                         |
| **Status**             | Open                                                                                                                           |
| **Affected component** | `auto-tag-release.yml`, `claude-pr-assign.yml`, `issue-auto-comments.yml`                                                      |
| **Description**        | `pull_request_target` runs in base-repo context with elevated trust. Dangerous if untrusted PR code is checked out + executed. |
| **Recommendation**     | Never checkout PR head with write secrets; keep jobs comment-only or use `pull_request` for build. Review Claude workflows.    |
| **Retest Result**      | Open — documented; issue-auto-comments merge path only checks out after merge (safer) but still needs ongoing review.          |

### INFRA-011 — Floating container image tags (`:latest`)

| Field                  | Value                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium                                                                                               |
| **Status**             | Open                                                                                                 |
| **Affected component** | Compose `paradedb/...:latest-pg17`, `rustfs/rustfs:latest`, Dockerfile `busybox:latest`              |
| **Description**        | Untagged/latest images change without notice — unreproducible deploys and sudden CVE exposure.       |
| **Recommendation**     | Pin by digest (`image@sha256:…`) for production; schedule image updates via Renovate docker manager. |
| **Retest Result**      | Open — accepted for this pass; pin digests in a follow-up deploy hardening PR.                       |

### INFRA-012 — Environment isolation (secrets across stages)

| Field                  | Value                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Low / Informational                                                                                                                         |
| **Status**             | Accepted Risk (ops)                                                                                                                         |
| **Affected component** | `.env.example*`, self-host docs, CI secrets                                                                                                 |
| **Description**        | Repo examples now use placeholders; production isolation depends on operators not reusing `AUTH_SECRET` / DB passwords across environments. |
| **Recommendation**     | Separate secrets per env; never copy prod `.env` to staging; rotate after any example-leak incident.                                        |
| **Retest Result**      | Accepted — document in self-host runbooks.                                                                                                  |

### INFRA-013 — Dev compose still publishes DB/Redis host ports

| Field                  | Value                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Low / Informational                                                                                                                 |
| **Status**             | Accepted Risk                                                                                                                       |
| **Affected component** | `docker-compose/dev/docker-compose.yml`                                                                                             |
| **Description**        | Dev stack still maps Postgres/Redis for local tooling convenience. Production deploy + Grafana stacks no longer publish by default. |
| **Recommendation**     | Keep host publish only in `dev`; never reuse the dev compose file for internet-facing hosts.                                        |
| **Retest Result**      | Accepted — intentional for local development.                                                                                       |

---

## 4. Remediations shipped with this audit

| ID        | Change                                                         |
| --------- | -------------------------------------------------------------- |
| INFRA-001 | Non-root `USER nextjs` on Aico/local Dockerfiles               |
| INFRA-002 | Deploy + Grafana compose: no default Postgres/Redis host ports |
| INFRA-003 | `.dockerignore` excludes `.env` / `.env.*`                     |
| INFRA-004 | Remove `NODE_TLS_REJECT_UNAUTHORIZED` from main Dockerfile     |
| INFRA-005 | Replace `actions-cool/pr-welcome@main` with `gh pr comment`    |
| INFRA-006 | Placeholder secrets in deploy + Grafana env examples           |
| Tests     | `src/utils/infra.security.controls.test.ts`                    |

---

## 5. Non-technical summary (for stakeholders)

We checked the “factory and warehouse” around Aico—not the chat screens.

- Some shipping containers ran with unnecessary full power → fixed (non-root).
- The default install left the database and cache on the street → fixed for the main deploy template.
- Example passwords that looked “real” were in the manuals → replaced with obvious placeholders.
- An automatic “welcome” robot on GitHub used an unsafe floating third-party tool → replaced with GitHub’s own tools.
- We still cannot fully scan third-party libraries for known holes until the project starts locking dependency versions in git (tracked as open work).
- The app still uses a database “master key” account; we recommend a limited account next (accepted for now to avoid breaking installs overnight).

---

## 6. References

- Plane: <https://plane.panafor.com/panaforai/browse/AICO-109/>
- Prior phase report style: `../phase-03-application-data/07-data-secrets-privacy-security.md`
- Regression: `src/utils/infra.security.controls.test.ts`
