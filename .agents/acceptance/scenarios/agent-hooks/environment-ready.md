# D environment preparation — continued preflight, 2026-09-28

This supersedes `environment.md`'s first-pass snapshot. No `execAgent` invocation, final Hook acceptance, branch integration or public PR was performed.

Latest continuation: `environment-step2.md` records repeated environment/quality checks and newly verified official local gateways plus real CLI-device marker write/read. It supersedes the device gap in this earlier table and supplies gateway startup/teardown commands.

| Item            | Verified state                                                                                                                               | Boundary                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Source          | D's own F66af6210-based preparation branch                                                                                                   | Final integrated revision still comes from coordinator                                       |
| Dependencies    | F layout inspected; 112 workspace packages point to D; third-party `.pnpm`/`.bin` APFS-cloned into D; F's supplemental cron-parser localized | Pin this graph for later base/current comparisons; no root-canary source used as D's runtime |
| Toolchain       | Bun 1.4.2, process-local Node 24.21.0, pnpm 12.4.1; source CLI resolves                                                                      | Avoid repository `pnpm run` automatic installation described below                           |
| DB              | D-owned ParadeDB/Postgres, loopback 55433; migration passed, 191 public tables, 1 seeded user                                                | No TITU database reused; private profile in ignored `.records/env/hooks-d-isolation.env`     |
| Redis           | D-owned Redis 7, loopback 56380, PING/PONG                                                                                                   | Available to D's future test workers                                                         |
| QStash          | Dev CLI 2.37.18 on 58080; authenticated health passed; generic infra probe returned 201 and reached receiver                                 | Local infrastructure proof, not managed-cloud or Agent Hook acceptance                       |
| S3              | s3rver loopback 59000; actual Put/Get/Delete preflight passed                                                                                | D's `.records/data/agent-testing-s3`                                                         |
| App             | Next 39926, Vite 21457; unauthenticated `/` 302, `/api/version` 200; process cwd D                                                           | Preparation build only                                                                       |
| CLI auth        | Source CLI `whoami` returned 200 and matched seeded account                                                                                  | Local profile only                                                                           |
| Web             | Cached agent-browser 0.38.1; dedicated session signed in, 27 stores and rendered root; homepage screenshot inspected                         | Session closed; auth state in D's `.records/hooks-d-auth`                                    |
| LLM / device    | Production catalogue had 2 enabled providers and one offline device                                                                          | No local real provider credential/inference or online local device/gateway pair yet          |
| Harness quality | 14 HTTP fixtures, disconnect/redaction, 16-hook factory pass; focused lint clean                                                             | No product case executed; no full-repo type pass claimed                                     |

Owned app/QStash/S3 processes are stopped at handoff. D's two DB/Redis containers remain per the project adapter. Restart the preview before opening it. User Chrome was not used.

## Restart

From D's worktree, load the private profile without printing it:

```bash
source .records/env/hooks-d-isolation.env
eval "$(.agents/acceptance/scripts/init-dev-env.sh env)"
```

In separate owned terminals, use the same environment:

```bash
.agents/acceptance/scripts/init-dev-env.sh s3
bun run dev
```

Start the D-owned QStash binary without invoking a package manager (see `dependency-incident.md` for provenance and verified installation boundaries):

```bash
./.records/bin/hooks-d-qstash-2.37.18 dev -port 58080
```

Then from D:

```bash
.agents/acceptance/scripts/test-env.sh
.agents/acceptance/scripts/init-dev-env.sh preflight
(
  unset LOBEHUB_JWT LOBEHUB_CLI_API_KEY LOBE_API_KEY LOBEHUB_WORKSPACE_ID
  source .records/env/agent-testing-cli.env
  bun apps/cli/src/index.ts whoami --json
)
export PATH="$PWD/.records/bin:$PATH"
export SESSION=hooks-d-preflight-c830e366 AUTH_DIR="$PWD/.records/hooks-d-auth"
export AGENT_BROWSER_IDLE_TIMEOUT_MS=1800000
.agents/acceptance/scripts/setup-auth.sh web-seed
```

Recheck URL and loaded state in the same browser probe sequence. The initial blank capture was `about:blank` after the daemon was lost between command contexts, not a product render. Loading D's auth again and explicitly opening the local URL produced the inspected homepage. In agent-browser 0.38.1 use `screenshot body <absolute-path>`; a lone path is interpreted as a selector. Close D's named session after inspection. The first helper run created a default home auth directory; only those newly created D files were removed after moving the workflow to D's own auth directory.

## Dependency incidents and evidence

The first checkpoint's missing-eslint/lint-staged failures and disclosed HUSKY=0 remain historical. Continued preflight installed no product changes, reviewed lint autofixes, corrected console/import style and reran focused lint clean.

F's initial layout shares root third-party storage and points additions to `/tmp/lobehub-hook-f-deps`. The existing QStash helper invoked `pnpm run`, which unexpectedly began a workspace install and failed at `packages/achaos/runner/node_modules/.bin`. At that time `.pnpm` was shared, so the attempt may have written the shared dependency store; coordinator was notified with the original log. No source branch was merged or other worktree edited. D then APFS-cloned its own 4.5 GB store/bin, repaired links and stopped running package installation inside the repository. Earlier F/K type counts are not evidence for this refreshed graph.

Turbopack could not resolve the external cron-parser link even though Bun could. Localizing its 4.7 MB supplementary store and restarting D changed authenticated `user.getUserState` from 500 to 200. A version endpoint or Bun resolution check alone would miss this. Optional Composio discovery lacks a server API key; homepage/auth work and this is not a Hook prerequisite.

Evidence: `.acceptances/hooks-d-phase1/assets/` contains dependency layout/isolation, local package resolution, owned container identities, migration, generic queue receipt, local-auth summary, browser auth/readiness and inspected `environment-home-v2.png`, lint and fixture smoke. Local scripts in `.acceptances/hooks-d-phase1/` reproduce setup/audits. Raw private logs, seed responses, cookies and generated environment must not be ingested as public evidence. Final runtime/provider/device/approval bindings and required Web Hook cards/parent replies remain unexecuted.
