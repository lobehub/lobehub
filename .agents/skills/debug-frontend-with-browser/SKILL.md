---
name: debug-frontend-with-browser
description: Reproduce, isolate, and verify frontend bugs with agent-browser across web and Electron surfaces. Use for intermittent rendering, ordering, stale-state, navigation, virtual-list, React/Zustand, optimistic-update, refresh-dependent, or browser-only failures where the broken boundary may be DOM, component props, derived store state, network data, or a pure transformation. Also use when collecting browser evidence, replaying an exact frontend fixture against local code, or attributing a frontend regression to a commit or PR.
---

# Debug Frontend with Browser

Find the first boundary where correct data becomes incorrect. Capture enough evidence to
separate a visible symptom from its source, then fix and verify at that source.

## Setup

1. Read the repository instructions and preserve the starting worktree state.

2. Load the installed browser workflows before driving the app:

   ```bash
   agent-browser skills get core
   agent-browser skills get electron # Electron only
   ```

3. Use the project's acceptance or agent-testing skill when the result needs a formal report.
   This skill owns diagnosis; the acceptance skill owns plan confirmation, evidence packaging,
   and publication.

4. Define a mutation budget before touching production data. Prefer a disposable fixture. If the
   real account is required, state the exact bounded actions and obtain approval.

5. Never read secret files or print credentials, tokens, private message content, or full live
   objects. Extract structural projections only.

## Workflow

### 1. Make the symptom falsifiable

Write one expected invariant and one observed violation. Include:

- the triggering action;
- the state before, during, and after it;
- whether refresh, navigation, tab switching, or waiting changes the symptom;
- the identifiers needed to follow the same entity across layers.

For timing or ordering bugs, define an event timeline before inspecting code.

### 2. Attach to the correct surface

For web pages, use a named browser session and the snapshot → action → re-snapshot loop.

For Electron:

1. Confirm the app was already running so it can be restored later.
2. Quit it gracefully.
3. Relaunch with a dedicated CDP port.
4. Pass `--cdp <port>` on every command in the attached session.
5. List targets when multiple windows or webviews exist.

Do not use `agent-browser open app://...`. Navigate custom-protocol SPAs through visible UI or:

```bash
agent-browser --cdp "$PORT" --session "$SESSION" pushstate '/target/path'
```

Read [references/pitfalls.md](references/pitfalls.md) for Electron, React-root, virtualization,
refresh, and attribution traps.

### 3. Reproduce before explaining

- Reproduce once without recording to prove the path.
- For an intermittent bug, retry with the same controlled action and record the hit rate.
- Record a GIF/video for behavior over time; use a screenshot only for a static broken state.
- Verify that the intended action actually happened by checking a new ID, network request, visible
  text, or state transition. A recording of the wrong click is not evidence.
- Re-snapshot after every navigation or major render because element refs become stale.

Keep failed captures, but cite only evidence that proves the claim.

### 4. Find the first broken boundary

Inspect layers from the visible consumer toward the source. At each layer, compare the same entity
IDs and state the result as `correct` or `incorrect`.

| Boundary            | Inspect                                      | What it rules out                          |
| ------------------- | -------------------------------------------- | ------------------------------------------ |
| DOM / visible row   | text, order, screenshot, timeline            | Confirms the symptom only                  |
| Renderer input      | virtual-list `dataSource`, component props   | Renderer versus upstream input             |
| Derived state       | selectors, parsed/display messages           | Store derivation versus raw state          |
| Raw client state    | provider props, fetched records, cache value | Fetch/cache versus transformation          |
| Network/server      | response status and structural payload       | Client versus server persistence           |
| Pure transformation | exact input passed to parser/normalizer      | Browser/runtime versus deterministic logic |

Important:

- DOM absence is not proof of state absence in a virtualized list.
- Multiple retained tabs can own multiple React roots and stores. Qualify a store by stable IDs,
  not by whichever Fiber is found first.
- Prefer the installed `agent-browser react` commands when React DevTools can be enabled. Use
  targeted Fiber evaluation only as a fallback, and serialize copied values immediately.
- Do not reorder data in the final renderer if an upstream parser already emits the wrong order.

Stop expanding the search once a pure local function reproduces the exact bad output.

### 5. Extract a safe exact fixture

Project the minimum fields required by the suspected transformation, usually:

- `id`, `role`, `parentId`, `createdAt`, and `updatedAt`;
- branch metadata;
- tool call/result linkage;
- agent, topic, thread, or group IDs when they affect grouping.

Omit content and unrelated metadata. Feed the exact array from the browser into the local function
without writing it to a tracked file:

```bash
agent-browser ... eval '<return JSON.stringify(projectedInput)>' \
  | jq -r . \
  | bun -e 'const input = JSON.parse(await Bun.stdin.text()); /* run local transform */'
```

Record input count, output count, the target ID's index, group membership, and a short output tail.

### 6. Attribute with the same fixture

Do not infer causality from PR timing or file names.

1. Run the same fixture against the suspected revision and its parent.
2. If needed, archive package snapshots into a temporary directory and import each snapshot without
   checking out the worktree.
3. Find the first revision where the observable output changes.
4. Verify the PR's actual file list, merge parent, and merge time.
5. Compare the trigger-data timestamps with the deployment or merge timestamp.

Local shallow or grafted histories can misattribute unrelated tree changes to the next visible
commit. Verify the real commit parent and path history through the GitHub API or `gh`.

### 7. Fix the earliest incorrect transformation

- Change the layer that first produced the invalid state.
- Preserve other branch, task, signal, and optimistic-update semantics.
- Add a behavior-level regression test with a sanitized minimal fixture.
- Add a JSDoc comment when the fix protects a non-obvious invariant or historical data shape.
- Avoid timeouts, refreshes, DOM sorting, or downstream filters as substitutes for a state fix.

### 8. Verify both synthetic and real inputs

Run, in order:

1. the focused regression test;
2. related package tests;
3. the exact real-data replay through the fixed local transformation;
4. the repository quality command;
5. visual/browser verification when the source change affects rendering behavior.

For real-data replay, make it read-only. The fixed output should remove the violating ID while
preserving the active group and newest valid tail.

### 9. Restore the environment

- Close only browser sessions created by this investigation.
- Quit the CDP-launched Electron app and reopen it normally if it was running before.
- Confirm the CDP port is closed.
- Remove or trash only exact temporary paths created by the investigation.
- Recheck both the root worktree and any submodule worktree; report pre-existing changes separately.

## Report

Lead with:

1. root cause and confidence;
2. the first broken boundary;
3. why suspected recent changes are or are not causal;
4. the fix and regression coverage;
5. remaining uncertainty.

Reference exact `path:line` locations before discussing implementation symbols. Link the issue,
PRs, acceptance report, and local evidence directory when available.
