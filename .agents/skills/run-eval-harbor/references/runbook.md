# Local Harbor Runbook

## Runtime Shape

```text
docker-compose/eval       host production process
  PostgreSQL :15433         LobeHub :3210
  Redis      :6380
  RustFS     :9100/:9101
  QStash     :8080/:8081
  Device GW  :8787
  Agent GW   :8788
```

Port `3010` belongs to normal development and is never a Harbor target.

## Prepare A Cold Harness

From the LobeHub repository root, create `docker-compose/eval/.env` from
`.env.example` only when it does not exist. Ask the user for
`DEEPSEEK_API_KEY` if it is empty and store it only in this ignored file. The
pinned `DEEPSEEK_PROXY_URL` prevents ambient Anthropic settings from changing
the DeepSeek SDK route.

Run the bootstrap and builds, then start the server in a dedicated terminal:

```bash
bash .agents/skills/run-eval-harbor/scripts/bootstrap.sh
bun --env-file=docker-compose/eval/.env run build
pnpm --dir apps/cli build
bash .agents/skills/run-eval-harbor/scripts/server.sh
```

`server.sh` is long-running and must not be replaced with a dev command.
Bootstrap first invokes `.agents/acceptance/scripts/init-dev-env.sh`, then starts
Compose, migrates the eval database, and seeds the dedicated user and CLI API
key. Generated CLI credentials remain in `.records/env/eval-harbor-cli.env`.

## Address And Eval Contract

LobeHub reaches published services on localhost:

```env
APP_URL=http://localhost:3210
DEVICE_GATEWAY_URL=http://localhost:8787
AGENT_GATEWAY_URL=http://localhost:8788
```

An external eval repository uses Docker-reachable host addresses:

```env
LH_AGENT_SLUG=inbox
LH_SERVER_URL=http://172.17.0.1:3210
LH_GATEWAY_URL=http://172.17.0.1:8787
AGENT_GATEWAY_URL=http://172.17.0.1:8788
LH_CLI_SOURCE=host-dir:/absolute/path/to/lobe-chat/apps/cli
LOBEHUB_CLI_API_KEY=<local-lobehub-api-key>
```

Resolve the actual bridge gateway instead of assuming `172.17.0.1`:

```bash
docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'
```

Inside a Harbor task, `localhost` is the task container. Use either
`LH_AGENT_SLUG` or `LH_AGENT_ID`, preferring a stable slug. Do not combine
`LH_AGENT_RUN_SSE` with `AGENT_GATEWAY_URL`.

`LH_CLI_SOURCE=host-dir:` requires an absolute path containing
`apps/cli/package.json` and `apps/cli/dist/index.js`; it injects this checkout's
CLI build rather than a published version.

## Preflight

```bash
bash .agents/skills/run-eval-harbor/scripts/preflight.sh /absolute/eval/repo
```

The script uses the local CLI build to check `whoami` and `agent view`, then
probes LobeHub and gateway endpoints from a fresh Docker container. A nonzero
exit blocks Harbor execution.

## Harness Smoke

```bash
bash .agents/skills/run-eval-harbor/scripts/run-smoke.sh
```

This runs `.agents/skills/run-eval-harbor/scripts/smoke/` with the pinned Harbor
adapter and local CLI build. The inbox agent must reply `hello world` and exit.
Verification is intentionally disabled: success is the real `lh agent run` exit
after authentication, Device Gateway registration, Agent Gateway dispatch,
QStash execution, and a model response.

## External Jobs And Resume

Use the external eval repository's own CLI and setup instructions; it owns task
discovery, agent registration, and output paths. Inspect its installed command
before resuming:

```bash
harbor jobs resume --help
```

Resume the exact requested job or trial. Never substitute a fresh job for a
failed resume.

## Inspect Results

Start at the job log and descend into the first failed trial. The harness smoke
uses `.records/harbor/jobs`; external repositories may choose another jobs
directory.

```text
<jobs-dir>/<job-id>/job.log
<jobs-dir>/<job-id>/<trial-id>/exception.txt
<jobs-dir>/<job-id>/<trial-id>/agent/setup/stdout.txt
<jobs-dir>/<job-id>/<trial-id>/agent/command-*/stdout.txt
<jobs-dir>/<job-id>/<trial-id>/verifier/
```

A later `device not found`, missing reward, or empty verifier output is often
fallout from an earlier login, CLI install, or gateway readiness failure.
