# Runta Execution Environment / FrontierHarness

Use this execution-environment overlay to run the FrontierHarness task set with
an Lh Cloud workspace agent. Runta is the sandbox host, not the LobeHub server
target; the current playbook overlays the cloud server route and does not expose
a local LobeHub server to Runta. Build and smoke-test the adapter first; a full
run spends real credits and starts two Runta runtimes.

## Required Inputs

- An official `frontierharness-eval` checkout pinned to a commit. Its `tasks/`
  directory is the task index used below.
- A ready golden checkpoint containing Harbor, Pier, and DeepSWE under
  `/work/deep-swe`. The launcher downloads Terminal-Bench once on its Harbor
  runtime when the checkpoint does not already contain it.
- An ignored dotenv file with `LH_AGENT_ID`, `LOBEHUB_CLI_API_KEY`, and
  `LOBEHUB_WORKSPACE_ID`.
- An authenticated `runta` CLI. The controller also needs an authenticated `lh`
  CLI when collecting billing usage.

The Lh agent owns the actual model. The required `--model` value is a benchmark
reporting label; it does not reconfigure the agent. Verify that the selected
agent uses the intended model before spending on a comparable run.

Prepare the generic benchmark checkpoint with the pinned FrontierHarness
provisioner. It installs Harbor, Pier, and DeepSWE; Lh does not need to be baked
into it:

```bash
FH=/absolute/path/to/frontierharness-eval/skills/frontierharness-eval/scripts

bash "$FH/provision-golden-checkpoint.sh" \
  --runtime fh-lh-build \
  --checkpoint fh-lh-public-golden \
  --harness lh \
  --provider fireworks \
  --repo \
  4 --memory 8192 --disk-size-gib 50 < this-repository-url > --commit < pinned-commit > --cpus
```

Build `apps/cli` on the controller before `start`:

```bash
(cd /absolute/path/to/this-repository/apps/cli && pnpm build)
```

The launcher packs its
`package.json` and `dist/` together with this skill's `scripts/lh/`, then uploads
that small artifact to both restored runtimes. It does not rebuild the repository
inside the runtimes or task containers.

## Execution Topology

A full run restores two machines from the same golden checkpoint:

```text
controller
├── Harbor runtime
│   └── Harbor schedules all Terminal-Bench tasks (default concurrency: 2)
└── Pier runtime
    └── Pier schedules all DeepSWE tasks (default concurrency: 1)
```

The controller does not launch tasks individually and does not stay attached.
It uploads one suite configuration per machine and starts Harbor/Pier as a
transient systemd unit. Harbor and Pier own their task queues and task-container
lifecycles. The systemd unit is only a durable launcher because `runta exec` has
no persistent-job API; it is not part of the public workflow.

Tasks within a suite share the Runta host and its image cache, but each task
still gets the container isolation implemented by its runner. Record the
topology as `two-shared-runta-runtimes`; it is not the published one-fresh-Runta-
runtime-per-task topology, so do not silently compare the resulting score with
that baseline.

## Public Network Policy

`public` is three separate decisions:

1. Each Runta runtime uses an empty denylist, allowing outbound traffic.
2. Each copied task definition sets only `[agent].network_mode = "public"`, so
   the Lh CLI can reach LobeHub Cloud, the device gateway, repositories, and
   package registries.
3. The original verifier and environment policy remains unchanged. In
   particular, opening the agent does not open a no-network verifier.

The launcher checks that its task rewrite did not alter the task's
`[verifier]` or `[environment]` data. It also mounts Runta's CA certificates
into Harbor/Pier task containers. Runtime egress alone is insufficient: without
the task-level change, the agent container remains offline.

## Start

Use the single orchestration script from this checkout. `start`
restores and prepares both runtimes, starts both suite schedulers, writes
`runs/<run-id>/run.json`, prints the runtime names, and exits.

```bash
RUNTA=/absolute/path/to/this-repository/.agents/skills/run-eval-harbor/scripts/frontierharness-runta.py

python3 "$RUNTA" start \
  --checkpoint fh-lh-public-golden \
  --run-id lh-kimi-k3-YYYYMMDD \
  --tasks /absolute/path/to/frontierharness-eval/tasks \
  --env-file /absolute/path/to/frontierharness-eval/.env \
  --model kimi-k3 \
  --out /absolute/path/to/frontierharness-eval/runs
```

Use a new run ID when the agent, model, checkpoint, task set, network policy, or
runner topology changes. `start` refuses to reuse an existing run record.

For a smoke test, pass one or more full task IDs with `--task`. Only the runtimes
needed by those tasks are restored:

```bash
python3 "$RUNTA" start \
  --checkpoint fh-lh-public-golden \
  --run-id lh-smoke-YYYYMMDD \
  --tasks /absolute/path/to/frontierharness-eval/tasks \
  --task terminal-bench/openssl-selfsigned-cert \
  --env-file /absolute/path/to/frontierharness-eval/.env \
  --model kimi-k3 \
  --out /absolute/path/to/frontierharness-eval/runs
```

## Inspect

`status` is deliberately one-shot. It reports the Runta and systemd states plus
completed/expected trial counts, then exits. Call it again when needed; do not
keep a controller process alive merely to sleep.

```bash
python3 "$RUNTA" status \
  --run /absolute/path/to/frontierharness-eval/runs/<run-id>
```

The inline launch command writes a `completion.json` with the scheduler's exit
code and duration. This survives even if systemd later unloads its transient
unit. `Result` and `ExecMainStatus` remain useful diagnostics. Individual task
failures are normal benchmark results and usually do not make the suite process
fail.

## Collect And Pause

Run `collect` only after both suites have completion records. It creates final
archives on the runtimes, verifies their SHA-256 hashes after download, extracts
them under each suite's `final/` directory, and then pauses both runtimes.

```bash
python3 "$RUNTA" collect \
  --run /absolute/path/to/frontierharness-eval/runs/ \
  /absolute/path/to/frontierharness-eval/.env < run-id > --env-file
```

The collector extracts operation IDs from the final agent logs and invokes
`lh usage --month ... --agent-id ... --json`. It retains the complete queried
rows as `lh-usage-raw.json` and exact-operation matches as `lh-usage.json`.
`spend` from this command is the actual LobeHub bill. Any FrontierHarness cost
computed by repricing the recorded tokens is a normalized comparison metric;
report the two separately.

Do not treat a running snapshot as final evidence. Final evidence consists of
the verified suite archives, `run.json`, final unit status, operation IDs, and
usage records. If usage collection fails, the runtimes are still paused because
billing lookup does not depend on them; repair authentication and collect usage
from the preserved operation IDs.
