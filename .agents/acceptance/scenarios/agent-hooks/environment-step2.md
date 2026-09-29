# D environment step 2 — verified infrastructure, 2026-09-28

This is environment preparation on D's F66af6210-based branch. No C1/C2 merge, `execAgent` invocation, Hook case execution, public PR or acceptance publication. The 31 product criteria remain unexecuted. Restart and verify served code again after the coordinator supplies the final integrated SHA.

## Observed results

| Component               | Result                                                                                                                                                                                         | Evidence under `.acceptances/hooks-d-env2/`                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Dependencies            | 112 root workspace links resolve to this worktree; agent-runtime/types/database resolve here from root, server and CLI; third-party store/bin and standalone CLI modules are local directories | `dependencies.json`, `workspace-resolution.jsonl`                                               |
| Postgres                | D container `lobehub-hooks-d-postgres`, owner label `hooks-d-c830e366`, port 55433; actual SQL returned database postgres, 191 public tables and one synthetic user                            | `containers.txt`, `db-query.txt`                                                                |
| Redis                   | D container `lobehub-hooks-d-redis`, same owner label, port 56380; actual PING returned PONG                                                                                                   | `redis-ping.txt`                                                                                |
| QStash simulator        | CLI 2.37.18, API 58080, auxiliary listener 58081; authenticated health passed; publish HTTP 201 reached the actual receiver in 819 ms                                                          | `preflight-final.log`, `queue-health.json`, `queue-receiver.jsonl`                              |
| S3                      | D s3rver 59000; helper performed real Put/Get/Delete                                                                                                                                           | `preflight-final.log`                                                                           |
| App                     | Next 39926, Vite 21457, process cwd is D; restarted with both local gateways                                                                                                                   | `listeners.txt`, private app logs                                                               |
| Local auth/UI           | Seed helper reused `user_agent_testing_001`; CLI whoami matched it; signed-in Web homepage inspected before and after gateway restart; authenticated server probe HTTP 200                     | `web-auth-final.json`, `web-server-auth-final.json`, `home-final.png`                           |
| Agent Gateway           | Official Worker locally on 58083; helper-signed local JWT received `auth_success`                                                                                                              | `agent-gateway-auth.log`                                                                        |
| Device Gateway          | Official Worker locally on 58084; isolated CLI device authenticated; local app listed it online and retrieved system info with cwd equal to D                                                  | `device-health.json`                                                                            |
| Actual device execution | Gateway forwarded `writeFile` and `readFile` to the source CLI; both HTTP 200/success; returned marker and actual disk contents agree                                                          | `device-tool-health.json`, `device-writeFile.json`, `device-readFile.json`, `device-marker.txt` |
| Preparation quality     | Scoped check: four TS files lint clean; 14 HTTP fixtures, abort/redaction and 16-hook factory pass                                                                                             | `scoped-check.log`, `fixture/receiver.jsonl`                                                    |

Device execution here is a direct infrastructure probe through the real gateway and CLI, not an Agent run or evidence for Hook allow/deny/rewrite. Local QStash is a simulator, not managed-cloud delivery. The UI evidence is a logged-in homepage, not tool cards or parent replies. No full-repository type pass is claimed.

## Gateway source and isolation

The helper documentation's sibling repositories were absent. The available official repositories are in `lobehub-biz`, not `lobehub`:

- `.records/hooks-d-gateways/device-gateway`: `lobehub-biz/device-gateway` at `b0bbeab8fef29f7607f432f0cfa481409410dca8`.
- `.records/hooks-d-gateways/agent-gateway`: `lobehub-biz/agent-gateway` at `e8a90533d6837d61fecef0e80ed40ae81dd175f6`.

Both checkouts, dependencies, generated `.dev.vars` and `.state-hooks-d` stores are D-owned and ignored. The alternate Go gateway checkout used to locate the official references was not run. No shared gateway checkout or `.dev.vars` was changed.

The existing `local-gateway-setup.sh` and `local-device-gateway-setup.sh` were copied unchanged into `.records/hooks-d-gateways/lobehub/.agents/acceptance/scripts/agent-gateway/`, so their sibling-path logic targets only D's checkouts. They read D's private `.records/env/hooks-d-gateway.env`. Invoke the device helper with `bash` because its source file is not executable. The generated RSA public JWK has `key_ops:['verify']` (private signing fields removed), as required by the existing Cloud gateway launcher. Local admin/service tokens and keys remain private; helper output is not public evidence.

Agent Gateway installed from its frozen lock using pnpm 10.34.4. Device Gateway has no root lock: its first install encountered ignored-build restrictions; an explicit D-checkout-only `pnpm-workspace.yaml` (`packages: ['.']`) and `pnpm install --no-frozen-lockfile --ignore-scripts` completed installation. Its actual Wrangler/workerd startup and execution were verified. Generated lockfiles stay inside the ignored gateway checkout. D's root lockfile and product dependencies were not changed by this step. Do not rerun the old dependency bootstrap against populated directories.

The device ID is `hooks-d-c830e366`, channel `hooks-d-preflight`. `.records/env/hooks-d-gateways.env` selects a CLI home beneath D's `.records/hooks-d-device`, containing its own connection ID/settings/metrics. Source this profile **after** the seeded CLI profile, whose default home is generic. No production login was redirected or reused.

## Reuse and start commands

Run each foreground service in its own terminal, keeping the terminal alive. Shell background jobs in short-lived tool commands did not survive; those initial launch attempts are not health evidence. The inherited Node selection is required.

Common environment, from D's worktree:

```bash
source .records/env/hooks-d-isolation.env
source .records/env/hooks-d-gateways.env
eval "$(.agents/acceptance/scripts/init-dev-env.sh env)"
```

DB/Redis remain running. If explicitly stopped, restart only the D containers after checking their owner labels:

```bash
docker start lobehub-hooks-d-postgres lobehub-hooks-d-redis
```

S3 and app, separate terminals with the common environment:

```bash
.agents/acceptance/scripts/init-dev-env.sh s3
.agents/acceptance/scripts/init-dev-env.sh dev
```

QStash, from a separate terminal at D's root; this verified binary starts without package installation. See `dependency-incident.md` for source hash and installation/cache boundaries:

```bash
./.records/bin/hooks-d-qstash-2.37.18 dev -port 58080
```

Each gateway in a separate terminal, from D's worktree:

```bash
cd .records/hooks-d-gateways/agent-gateway
ASDF_NODEJS_VERSION=24.21.0 WRANGLER_SEND_METRICS=false ./node_modules/.bin/wrangler dev \
  --local --ip 127.0.0.1 --port 58083 --inspector-port 59083 \
  --persist-to .state-hooks-d --show-interactive-dev-session=false
```

```bash
cd .records/hooks-d-gateways/device-gateway
ASDF_NODEJS_VERSION=24.21.0 WRANGLER_SEND_METRICS=false ./node_modules/.bin/wrangler dev \
  --local --ip 127.0.0.1 --port 58084 --inspector-port 59084 \
  --persist-to .state-hooks-d --show-interactive-dev-session=false
```

Device connection from D's worktree after the app and gateway are healthy:

```bash
source .records/env/hooks-d-isolation.env
unset LOBEHUB_JWT LOBEHUB_CLI_API_KEY LOBE_API_KEY LOBEHUB_WORKSPACE_ID
source .records/env/agent-testing-cli.env
source .records/env/hooks-d-gateways.env
bun apps/cli/src/index.ts connect --gateway http://127.0.0.1:58084 --device-id hooks-d-c830e366
```

Health commands, with common environment (and local CLI profile when invoking CLI):

```bash
.agents/acceptance/scripts/init-dev-env.sh preflight
GATEWAY_WS=ws://127.0.0.1:58083 node .agents/acceptance/scripts/agent-gateway/local-gateway-probe.mjs
bun apps/cli/src/index.ts device list --json
bun apps/cli/src/index.ts device info hooks-d-c830e366 --json
```

The reusable queue probe is `.acceptances/hooks-d-phase1/queue-health.ts`; set `HOOK_QUEUE_PROBE_LOG` to a **new** JSONL path each run. `.acceptances/hooks-d-env2/device-tool-health.ts` is the actual write/read probe; use a fresh marker/output directory for another run. It deliberately rejects an existing marker. Browser setup commands remain in `environment-ready.md`; use a unique session and the D-specific `AUTH_DIR`, then close that session.

## Stop and final handoff state

Stop the app with the existing helper from D's common environment:

```bash
.agents/acceptance/scripts/init-dev-env.sh stop-dev
```

For the other foreground services and device connection, use Ctrl-C in the terminal that started each. Automated shutdown must verify the recorded PID's command and cwd before stopping its descendant tree; never kill by shared process name or port alone. This run verified ownership and stopped its app, S3, QStash, gateways and CLI connection, and closed its named browser. `stopped-processes.json` records the owned roots. DB/Redis and persistent data remain reusable. The preview needs restarting before opening it.

## Remaining external requirements

- **Managed QStash:** no non-simulator credential was found in inherited environment or the checked LobeHub/LobeHub Cloud root `.env`/`.env.local` paths (all absent). Need an authorized managed-QStash token, the required signing configuration for cloud callbacks, and an authorized publicly reachable target. No cloud publish was attempted.
- **Real model:** no provider key was found in those sources; D's seeded DB has zero `ai_providers` rows and no user key vault. Need an authorized provider endpoint/key/model for a real inference probe. Production catalogue enabled flags from earlier investigation do not supply a local credential or prove inference.
- **Final integrated Hook execution:** coordinator-supplied final SHA, C2-stable bindings, then app restart/served-code verification and all 31 planned outcomes. Local device access is now available; Hook behavior through that device and Web tool cards/parent replies remain untested.

Private logs, cookie state, generated env and credentials are excluded from public ingestion. The coordinator can use the non-private health summaries above to distinguish verified infrastructure from pending product evidence.
