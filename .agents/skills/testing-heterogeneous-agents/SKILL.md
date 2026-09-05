---
name: testing-heterogeneous-agents
description: 'Manually runs the live LobeHub official-provider compatibility matrix across Claude Code, Codex, Grok Build, Kimi Code, Pi, and TRAE when explicitly invoked by the user.'
disable-model-invocation: true
---

# Testing Heterogeneous Agents

This project skill extends `acceptance` with one scenario: proving that every
server-advertised official model completes through each supported external CLI
agent and LobeHub's `server-default` provider binding.

It does not replace Acceptance. Use Acceptance for the plan, approval gate,
evidence contract, immutable rounds, publishing, and teardown. Use
`.agents/acceptance/PROJECT.md` for LobeHub's Electron launch, auth, CDP, and
multi-instance commands. This skill owns only the compatibility-matrix semantics
and its executable harness.

## Manual Invocation Only

The user invokes this skill with `/testing-heterogeneous-agents` in Claude Code
or `$testing-heterogeneous-agents` in Codex. Do not automatically load or execute
it as part of development, debugging, acceptance, or release tasks, and do not
schedule it. A reference from another skill is not permission to invoke it.
Manual invocation still requires scope and cost approval before live requests.

## Scope

The matrix covers:

- Claude Code, Codex, Grok Build, Kimi Code, Pi, and TRAE;
- models returned by the live `getServerDefaultHeterogeneousCapability` response;
- the real Desktop renderer → IPC → CLI → official relay path;
- the ingress selected by each agent (`anthropic-messages` or
  `openai-responses`);
- a unique marker round trip plus authoritative relay, provider, and model
  observations.

It does not cover user-defined providers, user-managed API keys, general model
quality, tool-use quality, or ordinary chat-agent execution. Add a separate
scenario instead of silently widening this matrix.

## Harness

```bash
HARNESS=.agents/skills/testing-heterogeneous-agents/scripts/official-smoke.mjs

# Discover the live matrix and installed CLI versions. Makes no model calls.
node "$HARNESS" list --json

# Narrow discovery when validating one change.
node "$HARNESS" list --agent claude-code,codex --model MODEL_ID --json

# Execute selected or all cells through the real official provider.
node "$HARNESS" run --confirm-live --topic-id TOPIC_ID --cdp 9222
```

Filters, topic id, and non-default CDP port are optional when the attached
Electron window already supplies the intended scope.

Exit codes:

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| `0`  | Every selected cell passed                                      |
| `1`  | At least one selected cell failed                               |
| `2`  | No failures, but at least one cell was blocked                  |
| `3`  | Electron, authentication, topic, or capability preflight failed |

## Run Workflow

### 1. Load the parent contract and project adapter

Read the `acceptance` skill, `.agents/acceptance/PROCESS.md`, and
`.agents/acceptance/PROJECT.md`. Follow their approval and teardown rules. This
scenario makes billable requests and creates server operation records, so never
infer permission to run it from a request to inspect or list the matrix.

### 2. Discover before spending

Run `list --json` first. It reads the live capability response and probes only
already-installed CLI binaries with version/help flags. Use its exact cells as
the plan; do not maintain a second hard-coded model list.

Report missing CLIs as blocked. Do not install, update, or sign in to an external
CLI during this workflow. To suppress Claude Code's background update paths even
during detection, start or restart the Electron instance with:

```bash
DISABLE_AUTOUPDATER=1 DISABLE_UPDATES=1 \
  .agents/acceptance/scripts/electron-dev.sh start
```

### 3. Establish the Electron surface

Use the Electron section of `.agents/acceptance/PROJECT.md` to attach to an
already-running signed-in instance or start one for this run. Confirm an active
personal topic or pass `--topic-id`. Never trigger an interactive OAuth flow.

### 4. Confirm scope, cost, and history

For each live run, present the discovered agents/models and obtain the
Acceptance plan approval before passing `--confirm-live`. Run sequentially; do
not parallelize cells because the CLIs share profiles and provider quota.

For repeated manual runs of the same compatibility scope, reuse one stable
Acceptance subject so every execution becomes another immutable round in the
same history. Previous runs do not authorize another live run.

### 5. Execute once

Run the selected matrix with `--confirm-live`. By default each CLI receives an
isolated workspace inside the report directory. Pass `--cwd` only when a real
project workspace is part of the compatibility claim.

The harness starts each cell idempotently in the renderer and polls it with short
host-side evaluations. Do not replace this with one long `agent-browser eval`:
long evaluations can be retried by the driver and duplicate live requests.

### 6. Inspect and publish the round

The harness writes an Acceptance-compatible `result.json`, one text evidence
artifact per cell, and a structured matrix table under:

```text
.records/reports/<timestamp>-heterogeneous-official-provider-smoke/
```

Unless `--report-dir` selects another location. Inspect the report and evidence;
do not infer success from the process exit code alone. Publish it with the clean
production `lh acceptance run ingest` environment required by
`.agents/acceptance/PROCESS.md`. Confirm that every matrix cell has its required
text evidence and return only the stable Acceptance URL.

### 7. Diagnose failures at the owning layer

Use each failed cell's evidence to identify the first broken boundary:

1. CLI launch or authentication;
2. request ingress and metadata normalization;
3. official relay/provider/model selection;
4. raw CLI output;
5. heterogeneous adapter or terminal mapping.

Load the `heterogeneous-agent` skill for raw trace, adapter, IPC, persistence, or
terminal-event diagnosis. A model refusing one ingress but passing another is a
request-compatibility signal, not proof of an adapter bug.

## Safety Invariants

- `run` requires `--confirm-live`; never bypass this gate.
- Never invoke installers, updaters, or sign-in flows.
- Never read custom provider credentials for this matrix.
- Claude Code cells receive both update-disabling environment variables.
- Missing binaries are blocked, not repaired automatically.
- Cells run sequentially to limit quota and profile contention.
- The harness listens to direct IPC and does not persist chat messages.
- Stop only the Electron instance started by the current run.

## Harness Self-Test

The self-test uses a fully stubbed `agent-browser`; it launches no browser,
external CLI, or model request:

```bash
bash .agents/skills/testing-heterogeneous-agents/scripts/official-smoke.test.sh
```
