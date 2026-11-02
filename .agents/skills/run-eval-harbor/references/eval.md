# LobeHub external eval runs

Use this mode to retain FrontierHarness datasets, case topics, telemetry and
verifier scores in LobeHub. Harbor/Pier still own task containers, scheduling
and verification. It supports `k=1`.

## Publish prompts

Authenticate the selected CLI to the selected server/workspace. Load the
ignored eval `.env` with `set -a; source /path/to/.env; set +a`. These examples
use the checkout CLI; omit `--cli-dir` to use installed `lh`.

Create a benchmark once with `lh eval benchmark create --identifier
frontier-harness --name FrontierHarness --json`, or select the existing ID from
`lh eval benchmark list --json`.

```bash
python3 .agents/skills/run-eval-harbor/scripts/lh/eval.py --cli-dir apps/cli publish \
  --benchmark-id <benchmark-id> \
  --identifier frontier-harness-<version> --name 'FrontierHarness <version>' \
  --harbor-tasks /path/to/terminal-bench/tasks \
  --pier-tasks /path/to/deep-swe/tasks \
  --frontier-dir /path/to/frontier-harness-eval \
  --output /path/to/dataset.json
```

`--frontier-dir` selects the canonical task IDs in that checkout's `tasks/`;
omit it for another Harbor/Pier dataset. `--case-id` can select individual cases.
Each source accepts a task directory or a parent containing task directories.
The same mixed task root can serve both source flags when task names carry the
`terminal-bench/` and `datacurve/` namespaces.

The publisher uploads `instruction.md` as the input, preserves
`task.toml`'s `task.name` as `metadata.caseId`, and sets `evalMode=external`.
Legacy tasks without a name use `terminal-bench/<directory>` or
`datacurve/<directory>`. It does not upload solutions, tests, Dockerfiles or
verifier secrets. The local manifest records the dataset ID, case mapping,
source commits and input/config hashes. Keep it with the run artifacts.

Repeat the same publish command and output path to complete an interrupted
upload. Existing case prompts are checked, never overwritten. Changed sources
require a new dataset identifier and manifest. Do not share a manifest between
servers or workspaces.

## Execute FrontierHarness on a Docker host / SSH worker

Pass `--eval-manifest /path/to/dataset.json` to the existing
`scripts/frontierharness-local.py start` command. Keep its existing task sources,
public network setup, CLI build, credentials and Harbor/Pier concurrency flags.
It checks selected task prompts against the manifest, creates and claims one
external run before scheduling, and injects the run ID and correct case ID into
each trial. The run's LobeHub ID and URL are saved in `run.json`.

The launcher starts one native Harbor job and one native Pier job. Each job
owns its queue and concurrency. Progress is in `jobs/<suite>/<job>/result.json`;
logs are `harbor.log` and `pier.log`. After both jobs exit, it reports all trial
rewards to LobeHub, retaining individual report errors without stopping either
queue. An infrastructure error or missing reward is a failure to execute/report,
not a fabricated zero score. Local artifacts remain available if reporting fails.
Resume through `harbor jobs resume` / `pier jobs resume` using that suite's job
directory. Re-submit its results with `report --all`, or a legacy one-task job with:

```bash
python3 .agents/skills/run-eval-harbor/scripts/lh/eval.py --cli-dir apps/cli report \
  --run-id <lobe-run-id> --case-id <case-id> --job /path/to/one-task-job
```

## Use either adapter directly

Create and claim the run once on the host:

```bash
python3 .agents/skills/run-eval-harbor/scripts/lh/eval.py --cli-dir apps/cli create-run \
  --manifest /path/to/dataset.json --agent-id "$LH_AGENT_ID" \
  --name 'FrontierHarness run' --output /path/to/eval-run.json
```

Use `--case-id` repeatedly for a subset, and `--experiment-id` to associate the
run with an existing experiment. The default server safety timeout is one hour;
set `--timeout-ms` to an appropriate deadline supported by the target server.
Harbor/Pier task timeouts and the runner's device idle timeout still apply
independently. If claim fails, the run receipt has already been saved; inspect
its status and claim that run instead of creating another one.

Configure the agent's environment per trial:

```json
{
  "LH_EVAL_CASE_ID": "<dataset-native-case-id>",
  "LH_EVAL_RUN_ID": "<lobe-run-id>",
  "LH_RUN_MODE": "eval"
}
```

Alternatively supply adapter kwargs `run_mode=eval`, `eval_run_id=...` and
`eval_case_id=...`. Use `lh.agent:LhInstalledAgent` for Harbor and
`lh.pier_agent:LhPierInstalledAgent` for Pier. CLI installation, authentication
and device gateway setup are unchanged. Explicit case IDs must be set per trial;
do not pass one shared case ID to a multi-task job.

For a multi-task Harbor/Pier job, omit `LH_EVAL_CASE_ID`: each adapter reads
`task.name` from the current environment's `task.toml`, falling back to
`terminal-bench/<task-directory>` or `datacurve/<task-directory>` for legacy tasks.
For Harbor, run one `harbor run` with
`--n-concurrent 4` and repeated `--exclude-task-name` flags. Harbor owns the
queue, trial errors, cleanup and resume; do not create a second queue outside it.
After the job exits, report all trial rewards with:

```bash
python3 .agents/skills/run-eval-harbor/scripts/lh/eval.py --cli-dir apps/cli report \
  --run-id <lobe-run-id> --job /path/to/harbor-job --all
```

Batch reporting attempts every trial and saves receipts/errors in
`eval-report.json`. A device idle interruption with a valid verifier reward is
reported with `termination=device_idle`; other trial exceptions remain errors.
Reporting runs after scheduling finishes, so a report failure cannot halt the
Harbor queue. Wrap the Harbor command and the final reporting command together
with the exit notification script.

The shared runner invokes `lh eval agent run --run-id ... --case-id ... --device local --json`, without a prompt override or agent override. It saves
`agent/run-start.json`, waits for the operation and eval completion hook, then
allows the verifier to run. Device cleanup reuses the normal runner.
Trajectories are exported directly with `lh topic export <topic-id> --format atif --output /logs/agent/trajectory.json`; there is no format conversion
layer in the adapter. Reporting must happen after verification on the host,
not inside the agent runner.

The checkout CLI sends its invocation cwd for `--device local`. The eval server
must support `workingDirectory` on `runExecuteCase` to pin that directory to the
created topic; older deployments can ignore the field. A cloud smoke against
an older server does not prove the newly added server behavior. Existing topics
keep their pinned cwd; a remote device ID does not inherit the caller's path.

## Smoke

Run the selected target preflight first. For the existing shared hello-world
smoke, provide a published hello-world case and an already claimed run through
`LH_EVAL_RUN_ID` / `LH_EVAL_CASE_ID`, then use
`scripts/run-smoke.sh cloud checkout /path/to/eval/repo eval`.

For a complete verifier/reporting smoke, use a tiny existing task with a real
verifier in each infra, for example Harbor's `examples/tasks/hello-workdir`.
Give the two copied tasks distinct `task.name` IDs, publish their original
instructions into a separate smoke dataset, and create/claim a run for both.
Run each task with its own adapter and case ID, then use the `report` command
above. Check all of:

- Both trials finish and the verifier reward is `1`.
- Each receipt links the correct case, operation and topic.
- Each topic reaches `external` before scoring, then `passed` after reporting.
- The final run is `completed` with two passed cases.
- The task container/device is reclaimed and `trajectory.json` was exported.

To verify cwd binding as well, inspect the topic metadata for the expected
`workingDirectory` and `boundDeviceId`. A task like `hello-workdir` can pass
using the daemon's current directory even if an older server ignores the new
field; a passing verifier alone does not prove the topic was pinned. Report
that deployment gap separately, without hiding it with a prompt override or a
device default change. Retain the dataset/run IDs and local logs if smoke is
blocked so it can resume without publishing duplicate data.
