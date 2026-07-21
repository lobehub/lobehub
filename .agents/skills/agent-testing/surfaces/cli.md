# CLI Backend Verification

Default surface for verifying **backend changes** (routers, services, models,
migrations) end-to-end: fastest loop, text-assertable output, zero UI flakiness.
The project's CLI, its invocation, and its auth all come from
[`.agents/acceptance/PROJECT.md`](../references/project-adapter.md) — this guide is the
methodology, not the commands.

## When to use

- Verifying router / service / model changes end-to-end
- Testing new API fields or response-structure changes
- Validating CLI command output after backend modifications
- Debugging data flow between server and client

## Prerequisites

| Requirement       | Where it comes from                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Dev server        | `PROJECT.md` §2 (base URL/port, start command, health check)                                                    |
| Project CLI       | `PROJECT.md` §4 (how the CLI is invoked — run-from-source or built binary — and its standalone install, if any) |
| Auth              | `PROJECT.md` §3 (test account / seeded key / device-code login)                                                 |
| Required services | `PROJECT.md` §6 (any queue/worker/store a command path depends on)                                              |

If the CLI runs from source, code changes on the CLI side usually take effect
immediately without a rebuild; if it is a built binary, rebuild per `PROJECT.md`
before re-testing. Confirm which from the adapter.

## Workflow

### 1 — Server up?

Health-check per `PROJECT.md` §2. Server-side code changes require a restart; the
CLI keeps talking to the old process until you restart it.

### 2 — Auth ready?

Run the CLI auth status check from `PROJECT.md` §3. If it is not authed, follow the
adapter's auth path (seeded credential first, interactive/device-code login as
fallback). Drive the login yourself — do not hand the user the step unless it needs
a secret or device action only they can supply.

### 3 — Test with CLI commands

Run the project's CLI commands for the behavior under test. Capture output for the
report as you go:

```bash
# $CLI = the project's CLI invocation from PROJECT.md
$CLI some-command | tee "$DIR/assets/case.txt"
```

CLI evidence for the report = the **exact command + trimmed output**. That is a
non-visual artifact, so a link/transcript in the report is fine (unlike UI cases,
which must inline a screenshot).

### 4 — Clean up test data

Delete any entities the run created (the adapter lists the CLI's delete commands if
the project has them). Leaving fixtures behind pollutes the next run.

### 5 — Report

Finish with a structured report — [../references/report.md](../references/report.md).

## Method notes (project-independent)

- **A backend change is still often a UI-visible change.** A permission tightening,
  a new field, a changed error — the blocked/changed state is something a user
  sees. If the change alters product behavior a user can observe, add a UI case in
  the same run (see [web.md](./web.md) / [electron.md](./electron.md)); do not ship
  a UI-touching change with only CLI transcripts.
- **Prove which runtime ran.** If a command can dispatch to more than one execution
  path (client vs server/queue), confirm the path you intended actually executed —
  a server operation row, a queue step, or a server-only log line — before trusting
  a green result.
- **A required service down looks like a logic bug.** If a command path POSTs to a
  queue/worker/store that is not running, the run can fail before any real work
  happens, with an error that reads as unrelated. Gate on the services `PROJECT.md`
  §6 marks as prerequisites.

## Dev-test cycle

```
1. Make code changes (service / model / router / type)
        |
2. Run unit tests (fast feedback)
        |
3. Restart dev server (if server-side changes)
        |
4. CLI verification (end-to-end): <cli> <command>
        |
5. Clean up test data + write the report
```

## Troubleshooting

| Issue                       | Direction                                                                |
| --------------------------- | ------------------------------------------------------------------------ |
| `No authentication found`   | Re-run the adapter's auth path (§3); source any generated credential env |
| `UNAUTHORIZED` on API calls | Re-seed / re-login per §3                                                |
| `ECONNREFUSED`              | Dev server not running — start per §2                                    |
| CLI shows old data/behavior | Server needs a restart to pick up code changes                           |
