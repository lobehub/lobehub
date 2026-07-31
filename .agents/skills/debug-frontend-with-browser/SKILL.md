---
name: debug-frontend-with-browser
description: Frontend diagnosis extension for agent-testing. Use for intermittent rendering, ordering, stale-state, navigation, virtual-list, React/Zustand, optimistic-update, refresh-dependent, or browser-only failures where the first broken boundary may be DOM, component input, derived state, client cache, network data, or a pure transformation. Before any browser, Electron, or live-app interaction, this skill must load and follow agent-testing; it adds only boundary tracing, minimal fixture replay, and regression attribution.
---

# Debug Frontend with Browser

Find the first boundary where correct data becomes incorrect. This skill extends
`agent-testing`; it does not define a separate test workflow.

## Mandatory foundation

Before any browser, Electron, network, cache, or application interaction:

1. Read [`../agent-testing/SKILL.md`](../agent-testing/SKILL.md) in full.
2. Follow its target grounding, living logs, project adapter, environment and auth
   checks, approval gate, evidence rules, publication, and teardown.
3. Enter this diagnostic workflow only after `agent-testing` has established the
   approved execution surface. If its environment or auth gate is blocked, stop
   there instead of inventing another execution path.
4. Use the isolated environment and fixture strategy selected by the project
   adapter. Never use the user's signed-in production browser or Electron client
   as a fixture container or test sandbox.
5. Treat an explicit production investigation as read-only unless the user
   separately authorizes an exact live mutation and the project adapter permits
   it. This skill never grants production-mutation authority.
6. Never read secret files or print credentials, tokens, private content, or full
   live objects. Return structural projections only.

If `agent-testing` is unavailable, say so and stop before touching a live surface.

## Responsibility boundary

| `agent-testing` owns                        | This skill adds                        |
| ------------------------------------------- | -------------------------------------- |
| Environment isolation and service lifecycle | Falsifiable symptom and event timeline |
| Authentication and fixture seeding          | Boundary-by-boundary state comparison  |
| Browser/Electron driver setup               | Safe minimal fixture extraction        |
| Approval and mutation authority             | Pure-function replay and commit A/B    |
| Evidence, report, publication, teardown     | Earliest-boundary fix guidance         |

Do not duplicate or weaken `agent-testing` rules here. When the two skills appear
to conflict, `agent-testing` and the project adapter control execution.

## Diagnostic workflow

### 1. Make the symptom falsifiable

Write one expected invariant and one observed violation. Record:

- the triggering action;
- state before, during, and after it;
- whether navigation, remount, refresh, tab switching, or waiting changes it;
- stable identifiers required to follow the same entity across layers.

For timing or ordering defects, define the expected and observed event timelines
before reading implementation code.

### 2. Reproduce on the approved isolated surface

- Reproduce once without recording to prove the path.
- For an intermittent defect, repeat the same controlled action and record the
  hit rate.
- Verify the intended action through a new ID, request, or state transition.
- Use a GIF or video for flicker and other time-based behavior.
- Re-snapshot after navigation or a major render because element references expire.

Use the surface and capture method chosen by `agent-testing`; do not relaunch or
reattach to the user's resident application.

### 3. Find the first broken boundary

Compare the same entity IDs at each layer and mark each boundary `correct` or
`incorrect`.

| Boundary            | Inspect                                   | What it distinguishes          |
| ------------------- | ----------------------------------------- | ------------------------------ |
| DOM / visible row   | Text, order, recording                    | Symptom only                   |
| Renderer input      | Component props, virtual-list data        | Renderer vs upstream input     |
| Derived state       | Selectors, parsed/display items           | Derivation vs raw state        |
| Raw client state    | Store records, SWR state, persisted cache | Cache vs transformation        |
| Network / server    | Structural response and persisted row     | Client vs server               |
| Pure transformation | Exact parser/normalizer input             | Runtime vs deterministic logic |

Important:

- DOM absence is not state absence in a virtualized list.
- Retained tabs can own multiple React roots and stores; qualify them by stable
  IDs and the visible route.
- For cache defects, distinguish in-memory fetch cache, Zustand state, persisted
  cache, and server state instead of calling all of them "the cache."
- Stop expanding the search when a pure local function reproduces the exact
  invalid output.

### 4. Build the smallest safe fixture

Create the fixture through the isolated environment's supported seed path. Keep
only fields required by the suspected boundary, such as:

- `id`, type or role, parent linkage, and timestamps;
- cache key and lifecycle state;
- branch or group metadata;
- entity identifiers that affect selection or grouping.

Store reusable inputs through the `agent-testing` fixture layout. Do not copy
private production content into fixtures or tracked files.

### 5. Attribute with the same fixture

Do not infer causality from PR timing or filenames.

1. Run the same fixture against the suspected revision and its real parent.
2. Compare the same observable boundary, not two different screenshots.
3. Verify the commit parent, PR file list, merge time, and deployment timing.
4. Separate the revision that introduced the latent bug from the data event that
   first exposed it.

### 6. Fix the earliest incorrect boundary

- Change the layer that first produces invalid state.
- Preserve unrelated branch, optimistic-update, and cache semantics.
- Add a behavior-level regression test with the sanitized minimal fixture.
- Add a JSDoc comment when the fix protects a non-obvious invariant.
- Do not substitute timeouts, refreshes, DOM sorting, or downstream filters for a
  source-state fix.

### 7. Return to agent-testing for verification

After diagnosis or a fix, resume the parent `agent-testing` workflow. It owns the
focused checks, isolated visual replay, evidence inspection, structured report,
publication, and cleanup. Do not publish a separate browser-debugging verdict.

## Diagnostic supplements

Read [references/pitfalls.md](references/pitfalls.md) when the suspected boundary
involves retained React roots, virtualized data, optimistic reconciliation, stale
client caches, pure replay, or regression attribution.
