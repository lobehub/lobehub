# Cloud Target

Use this route for LobeHub Cloud or another remote production LobeHub server.
Do not start local Compose, bootstrap a local user, launch `server.sh`, or
replace any remote address supplied by the eval repository.

## Prepare

The external eval repository's ignored `.env` must contain:

```env
LH_AGENT_ID=<selected-agent-id>
LOBEHUB_CLI_API_KEY=<cloud-cli-api-key>
```

For official LobeHub Cloud, leave `LH_SERVER_URL`, `LOBEHUB_SERVER`,
`LH_GATEWAY_URL`, and `AGENT_GATEWAY_URL` unset so the CLI uses its official
defaults. For a custom remote deployment, preserve its supplied URLs and require
both `LH_GATEWAY_URL` and `AGENT_GATEWAY_URL`; if both `LH_SERVER_URL` and
`LOBEHUB_SERVER` are present, they must match.

The selected cloud agent already owns its model and provider configuration. Do
not ask for or inject a local provider key.

For CLI mode `checkout`, build this checkout before smoke:

```bash
pnpm --dir apps/cli build
```

CLI mode `npm` installs the published `@lobehub/cli` in the Harbor task.

## Gate Before A Real Job

Cloud preflight probes the selected server and available gateways from both the
host and Docker. It is read-only and does not authenticate or call a model.

```bash
bash .agents/skills/run-eval-harbor/scripts/preflight.sh cloud /absolute/eval/repo
bash .agents/skills/run-eval-harbor/scripts/run-smoke.sh cloud checkout /absolute/eval/repo
# or: run-smoke.sh cloud npm /absolute/eval/repo
```

Both commands must pass before a real Harbor run or resume. The shared smoke is
the proof that the API key, agent selection, CLI installation, device
registration, gateways, and one actual model response work end to end.

After smoke, use the external eval repository's own run/resume command. Never
substitute a fresh job for a requested resume.
