# Local Target

Use this route for a production LobeHub build from this checkout. Port `3010`
is development-only; Harbor always targets the production server on `3210`.

## Confirm Network Safety

Before starting anything, ask the user to confirm that this machine is trusted
and that LobeHub port `3210` plus all configured eval ports are unreachable from
the public internet and other untrusted networks. The defaults are PostgreSQL
`15433`, Redis `6380`, RustFS `9100`, QStash `8080`/`8081`, and the
gateways `8787`/`8788`. Stop if the user cannot confirm this.

PostgreSQL, Redis, and the RustFS API bind only to host loopback. The RustFS
admin port is not published. Gateways bind to loopback for LobeHub and to
`EVAL_DOCKER_BRIDGE_ADDRESS` for Harbor containers. QStash is the exception: its
dev binary has no bind-address option and uses host networking so callbacks to
the host LobeHub `APP_URL` work; firewall isolation is therefore still required
for `8080`/`8081`. The stack uses fixed development credentials, including its
seeded CLI key and gateway service token, so it is not suitable for an
internet-facing host.

## Prepare

Create `docker-compose/eval/.env` from `.env.example` only when it is absent.
The seeded CLI key resolves the isolated user's builtin `inbox` agent
automatically; no Web login or copied agent id is required. Set `LH_AGENT_ID`
only to override that default with a specific agent. For a workspace agent, also
set `LOBEHUB_WORKSPACE_ID` to its workspace id. Reuse a provider credential
already stored in LobeHub or configured in this ignored env. If smoke reports
`InvalidProviderAPIKey`, inspect the resolved agent's provider/model, ask only
for that provider's actual credential, add it to the ignored env, and restart
the server. `DEEPSEEK_API_KEY` is one example, not a required or generic key.

```bash
bash .agents/skills/run-eval-harbor/scripts/bootstrap.sh
bun --env-file=docker-compose/eval/.env run build
bash .agents/skills/run-eval-harbor/scripts/server.sh
```

`server.sh` is long-running. Bootstrap starts PostgreSQL, Redis, RustFS, QStash,
Device Gateway, and Agent Gateway, migrates the database, then seeds the eval
user and CLI key. Keep `.records/env/eval-harbor-cli.env` private.

For CLI mode `checkout`, also run:

```bash
pnpm --dir apps/cli build
```

CLI mode `npm` installs the published `@lobehub/cli` in each Harbor task and
does not require a local CLI build.

## Addresses

LobeHub uses localhost service URLs. Harbor containers need host addresses:

```env
LH_SERVER_URL=http://172.17.0.1:3210
LH_GATEWAY_URL=http://172.17.0.1:8787
AGENT_GATEWAY_URL=http://172.17.0.1:8788
```

Resolve the bridge gateway instead of assuming `172.17.0.1`:

```bash
docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'
```

## Gate Before A Real Job

Run the local service preflight, then the model-backed smoke with the selected
CLI mode. Both must pass before running or resuming a real Harbor job.

```bash
bash .agents/skills/run-eval-harbor/scripts/preflight.sh local
bash .agents/skills/run-eval-harbor/scripts/preflight.sh local /absolute/eval/repo
bash .agents/skills/run-eval-harbor/scripts/run-smoke.sh local checkout /absolute/eval/repo
# or: run-smoke.sh local npm /absolute/eval/repo
```

The default smoke invokes `lh agent run`. To evaluate the persistent Task path
instead, select `task`; the adapter creates one Task for the trial and starts it
on the connected Harbor device with `lh task run --device local`:

```bash
LH_RUN_MODE=task bash .agents/skills/run-eval-harbor/scripts/run-smoke.sh local checkout
```

The local smoke requires `LOBEHUB_CLI_API_KEY`. Unless `LH_AGENT_ID` overrides
it, the installed CLI resolves `LH_AGENT_SLUG=inbox` to a concrete id before the
run. The smoke calls that agent, requires `hello world`, and exits. Preflight
intentionally checks neither credential nor model access; that is smoke's job.

Use the external eval repository's own run/resume command after smoke. Inspect
failures from `<jobs-dir>/<job-id>/job.log`, then the failed trial's
`exception.txt`, `agent/setup/`, `agent/command-*/`, and `verifier/` artifacts.

## Stop

```bash
docker compose --env-file docker-compose/eval/.env \
  -f docker-compose/eval/docker-compose.yml down
```

Do not add `-v` unless the user explicitly asks to discard eval data.
