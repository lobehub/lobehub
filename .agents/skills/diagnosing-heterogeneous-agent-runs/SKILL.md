---
name: diagnosing-heterogeneous-agent-runs
description: Diagnose a local LobeHub Desktop heterogeneous-agent run from a topic, session, or the latest trace.
disable-model-invocation: true
argument-hint: '<topic-id | session-id | latest>'
---

# Diagnose Local Heterogeneous-Agent Runs

Investigate a real LobeHub Desktop external-agent run from persisted evidence before reproducing it or changing code. Keep the investigation read-only unless the user separately asks for a fix.

## Responsibility Boundary

This skill owns incident triage for an installed or locally running LobeHub Desktop app:

- resolve a topic, native agent session, Desktop process session, or latest run;
- correlate Desktop state, process logs, raw CLI output, and native-agent history;
- identify the first failed boundary and explain why LobeHub displayed the observed state;
- hand a source-level defect to the skill that owns the implementation.

Do not duplicate downstream workflows:

- Use `heterogeneous-agent` after evidence points to a driver, adapter, stream protocol, resume, tool persistence, or terminal-event bug.
- Use `agent-tracing` for the normal server-side AgentRuntime, LLM/context-engine snapshots, or `agent_operations.trace_s3_key`; `.agent-tracing/` is not the Desktop CLI trace store.
- Use `agent-testing` only when controlled reproduction or Electron/browser verification is still needed.
- Use `debug-package` when adding or changing debug namespaces rather than interpreting existing logs.

## Safety Rules

- Start read-only. Do not retry a paid agent run, change proxy settings, edit bindings, delete traces, or mutate SQLite unless the user explicitly requests that action.
- Treat topic reports and UI labels as claims. Confirm the terminal event and persisted error before naming a root cause.
- Do not print complete prompts, `stdin.txt`, tool output, attachment contents, binding profiles, environment values, tokens, cookies, or credentials.
- `meta.json` contains environment key names, not values; report only the keys needed to explain behavior.
- Query SQLite with `mode=ro` and summarize only structural fields and errors.
- Preserve unrelated files and sessions. A shared Desktop profile may contain other users' or agents' private material.

## Artifact Map

On macOS, the default roots are:

```text
~/Library/Application Support/LobeHub/lobehub-storage/
├── local-database.sqlite3
└── heteroAgent/
    ├── bindings/  stable provider-bound CLI profiles
    ├── files/     downloaded attachment cache
    ├── runs/      per-run resources, normally removed after execution
    └── tracing/   opted-in packaged/Desktop CLI traces

~/Library/Logs/LobeHub/main.log
```

Plain development runs with centralized tracing disabled write to `<cwd>/.heerogeneous-tracing/` instead. The misspelling is the real directory name.

Use each `heteroAgent/` directory deliberately:

| Directory  | Inspect when                                                                | Do not assume                                           |
| ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `tracing`  | CLI spawn, stdout protocol, stderr, exit, model/session identity            | exit code 0 means the run succeeded                     |
| `bindings` | provider binding, isolated CLI HOME, auth/config, resume/profile corruption | every agent has a binding; native Amp commonly does not |
| `runs`     | a live run or abnormal cleanup may have left temporary provider files       | an empty directory means no run occurred                |
| `files`    | image/file download, MIME, attachment handoff, cache mismatch               | attachment bytes explain an unrelated runtime failure   |

## Default Workflow

### 1. Ground the target

Accept one of:

- `tpc_...`: preferred because it can connect LobeHub state to a native session;
- a native session such as an Amp `T-...` thread;
- a Desktop process-session UUID from `main.log` or a trace directory;
- `latest`: the path in the active trace root's `.last-live-trace`.

Confirm whether the user means an installed packaged app or a source development run. Check the running process and listening ports rather than guessing.

### 2. Collect a redacted evidence index

From the repository root, run:

```bash
TARGET='tpc_...'
python3 .agents/skills/diagnosing-heterogeneous-agent-runs/scripts/collect-local-run.py "$TARGET"
```

The script is read-only. It reports:

- top-level `heteroAgent/` inventory;
- topic status, provider, working directory, binding key, and native session IDs from the local SWR cache;
- persisted assistant errors without message content;
- matching trace metadata, process exit, terminal `result`, and stderr size;
- focused `main.log` lines for matching sessions and nearby transport/proxy activity.

Use `--storage-root` and `--log-file` when the app uses a non-default profile or another OS path:

```bash
TARGET='tpc_...'
python3 .agents/skills/diagnosing-heterogeneous-agent-runs/scripts/collect-local-run.py \
  "$TARGET" \
  --storage-root /path/to/lobehub-storage \
  --log-file /path/to/main.log
```

For a development run that writes beside the working directory, point directly at that trace root:

```bash
python3 .agents/skills/diagnosing-heterogeneous-agent-runs/scripts/collect-local-run.py \
  latest \
  --trace-root "$PWD/.heerogeneous-tracing"
```

If the script finds no trace, do not conclude that the run never happened. Check whether packaged tracing was enabled, whether the app used the dev trace root, and whether retention or cleanup removed the evidence.

### 3. Build one timeline across evidence planes

Correlate stable identifiers and timestamps in this order:

```diagram
┌─────────────┐    ┌──────────────────┐    ┌────────────────┐
│ Lobe topic  │───▶│ Desktop session  │───▶│ Native session │
│ tpc_...     │    │ UUID / operation │    │ T-... / CLI id │
└──────┬──────┘    └────────┬─────────┘    └───────┬────────┘
       │                    │                      │
       ▼                    ▼                      ▼
 local cache          main.log + trace       native history
```

Record separately:

1. user action and topic status transition;
2. process spawn args/cwd and process exit code;
3. raw protocol terminal event and its `is_error`/subtype/message;
4. persisted assistant error shown by LobeHub;
5. nearby gateway, WebSocket, TLS, proxy, updater, or device events.

Do not merge process success with protocol success. A CLI may exit 0 after correctly emitting `result.is_error: true`; the adapter should still mark the topic failed.

### 4. Inspect the narrowest raw evidence

For every matching trace, read in this order:

1. `meta.json` — agent type, command, cwd, process/native session IDs, resume ID, safe environment key names;
2. `exit.json` — OS process code and signal;
3. terminal records from `stdout.jsonl` — `result`, error subtype, turn count, duration;
4. focused raw events immediately before the terminal record;
5. `stderr.log` only when non-empty.

Avoid dumping entire JSONL files. Select event type, tool ID, stop reason, success flag, and terminal fields with `jq`, Python, or `rg`.

### 5. Inspect native-agent history when available

- Amp: use the `T-...` value from `agentSessionId`, `resumeSessionId`, or topic metadata to read the Amp thread. Distinguish tool-level failures from the CLI's terminal `result`.
- Claude Code/Codex: inspect their isolated binding/session data only when auth, provider configuration, resume continuity, or native history is the suspected boundary. Start from filenames, schemas, and selected structural fields; do not dump profiles or transcripts.
- Other agents: use their trace protocol and driver source. Do not force Claude/Codex assumptions onto ACP or other runtimes.

### 6. Classify the first failed boundary

Use the earliest category supported by evidence:

| Boundary           | Evidence examples                                                                    |
| ------------------ | ------------------------------------------------------------------------------------ |
| Launch/preflight   | binary missing, cwd invalid, spawn error, nonzero exit before protocol init          |
| Provider binding   | missing endpoint/key reference, incompatible protocol, isolated profile/config error |
| External transport | WebSocket 1006, TLS reset, DNS/proxy failure, upstream connection termination        |
| Native agent/model | terminal provider error, quota/auth/model rejection, native thread error             |
| Adapter/protocol   | valid raw event misclassified, missing required terminal event, wrong tool mapping   |
| Persistence/UI     | adapted terminal is correct but message error/topic status/tool rows are wrong       |
| Attachment handoff | cached file missing, MIME mismatch, upload/download failure                          |

Treat later failures as consequences unless they independently explain the user-visible symptom. For example, a tool's bad `sed` path is not the root cause of a later inference connection reset.

### 7. Explain the source path only after classification

Once the first failed boundary is known, follow the exact source symbols that transform it:

1. Desktop spawn and trace recorder;
2. agent adapter terminal conversion;
3. renderer heterogeneous executor and error persistence;
4. topic/message state displayed by the UI.

Show why an apparently contradictory state is expected or buggy—for example, process exit 0 versus `result.is_error: true`. Do not browse every driver before knowing which agent and boundary failed.

### 8. Report facts, inference, and next action separately

Return a compact diagnosis containing:

- target topic and correlated session IDs;
- chronological failure timeline;
- exact terminal error and first failed boundary;
- why LobeHub displayed the observed status;
- root cause with confidence level;
- secondary/non-causal errors explicitly excluded;
- safest next action and whether it changes state or incurs model usage.

If evidence is incomplete, state the missing artifact and make the conclusion conditional. Do not manufacture certainty from a UI screenshot or process exit code alone.

## Handoff to Implementation

When the evidence demonstrates a LobeHub source defect, load `heterogeneous-agent`, add a regression test at the earliest incorrect layer, implement the smallest fix, and verify it. Keep this skill's evidence timeline as the bug's behavioral contract; do not continue broad incident archaeology after the source boundary is proven.
