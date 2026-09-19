---
name: run-eval-harbor
description: 'Run and diagnose existing Harbor or FrontierHarness evaluations against local production LobeHub or LobeHub Cloud, either locally or on Runta. Use for eval infrastructure, target preflight, lh CLI injection, Harbor smoke or job runs, resume, and failure triage. Excludes authoring Harbor tasks and product acceptance.'
---

# Run Eval Harbor

Run existing Harbor evaluations against either this checkout's isolated local
production harness or a remote LobeHub target. Use `create-task` to author or
grade tasks and `acceptance` for product acceptance.

## Ask First

Before preparing or running anything, obtain these independent choices. Do not
use `runta` as a LobeHub server target or `checkout` as an execution environment:

1. LobeHub server: `local` production server from this checkout, or
   `cloud`/remote.
2. Execution environment: this local host, or Runta runtimes. The maintained
   Runta workflow currently targets a cloud/remote LobeHub server.
3. CLI source: `checkout` build from `apps/cli`, or published `npm` release.
4. Agent selection: cloud requires an exact `LH_AGENT_ID`; local uses the seeded
   user's builtin `inbox` agent unless the user explicitly selects a different
   agent.
5. Eval repository path and whether the user wants a new job or a resume.
6. Credentials: for cloud, require its CLI API key in the eval repository's
   ignored `.env`. Local bootstrap seeds its CLI key. Reuse a provider
   credential already configured in LobeHub or the ignored local env; if the
   smoke reports `InvalidProviderAPIKey`, report the resolved agent's
   provider/model and ask only for that provider's real credential.
7. For a local LobeHub server, obtain explicit confirmation that port `3210` and
   every configured eval infrastructure port are unreachable from the public
   internet and other untrusted networks. Do not bootstrap the local stack
   without confirmation.

For the Runta execution environment, also collect the harness repository and
pinned commit, provider/key choice required by FrontierHarness, and the
Terminal-Bench versus DeepSWE task subset. The Lh Cloud agent's model remains
selected by `LH_AGENT_ID`; do not replace it with FrontierHarness's `--model`
unless the run is explicitly non-comparable.

Do not infer these choices. DeepSeek is only one provider example, not a
required credential or model.

## Guardrails

- In local mode, run LobeHub on port `3210` with `bun run start`; never target a
  dev server or port `3010`. Compose owns infrastructure; LobeHub stays on the
  host.
- In cloud mode, never start local infrastructure or rewrite server/gateway
  addresses. Official Cloud should use the CLI's default addresses.
- Create `docker-compose/eval/.env` from `.env.example` only when absent; never
  overwrite an existing file.
- The local Compose stack publishes host ports and uses fixed development
  credentials, including the seeded CLI key and gateway service token. Never
  run it on a host where those ports are reachable by an untrusted network.
- Never infer `inbox` for a cloud server, choose a separate model, or override
  the agent with `DEFAULT_AGENT_CONFIG`. A local server may resolve the isolated
  seeded user's builtin `inbox` through the authenticated CLI. Never invent,
  print, or commit secrets.
- LobeHub uses localhost service URLs. Harbor containers use Docker-reachable
  host URLs. Never interchange them.
- Preflight is target-specific and read-only: local checks the local production
  stack; cloud checks the remote server/gateways. It does not validate API keys,
  agents, provider credentials, or model access.
- Do not run a model-backed Harbor job without an explicit user request.
- Before every requested real job or resume, run the shared model-backed smoke
  for the chosen server target and CLI source. Stop if either preflight or smoke
  fails.

## Run

Read exactly one reference for the selected LobeHub server:

- Local server: [references/local.md](references/local.md)
- Cloud/remote server: [references/cloud.md](references/cloud.md)

When the execution environment is Runta, additionally read the
[Runta/FrontierHarness playbook](references/runta.md). It overlays the cloud
server route; it is not a third server target.

CLI source is orthogonal to the server target and execution environment:
`checkout` injects the built `apps/cli`; `npm` installs the release package. For
local execution, run the selected server preflight and then
`scripts/run-smoke.sh <local|cloud> <checkout|npm> ...` before the external eval
repository's own job command. The maintained Runta workflow uses a checkout CLI
artifact, two restored suite runtimes, and a detached start/status/collect
workflow; do not substitute a normal Harbor job for it.

Harbor and Pier default to `LH_RUN_MODE=agent`. Set `LH_RUN_MODE=task` to create
one persistent LobeHub Task per trial and run it on the connected eval device;
operation polling, output collection, usage evidence, and device cleanup remain
the same.

## Diagnose

- PostgreSQL, Redis, RustFS, QStash, or Compose state: local eval infrastructure.
- Port `3210`, migrations, API-key auth, or `/api/version`: LobeHub.
- Ports `8787`/`8788`, gateway health, or service tokens: gateway.
- Docker-only connectivity: bridge address, published port, or host firewall.
- CLI upload/install: `LH_CLI_SOURCE` or `apps/cli/dist`.
- Reward/verifier behavior: the Harbor task; use `create-task` before changing it.

## Harbor Reference

For Harbor commands beyond these scripts, consult the official
[Harbor Skills](https://github.com/harbor-framework/skills), especially its
`harbor-cli` skill. This harness pins `harbor==0.23.0`; when guidance differs,
the pinned CLI's `--help` is authoritative.
