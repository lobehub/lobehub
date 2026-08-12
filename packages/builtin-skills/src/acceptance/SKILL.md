---
name: acceptance
description: >
  Self-evidence for delivery verification in any repository, with or without
  LOBE_OPERATION_ID or a preconfigured verify plan. Discover an existing plan
  when present; otherwise author checks and publish a standalone acceptance.
  Pick the proving surface (CLI / web / desktop / iOS Simulator), capture real
  evidence, and submit it with the lh CLI. Triggers on 'verify the task',
  'collect evidence',
  'prove it works', 'upload evidence', 'verify plan', 'requiredEvidence', or any
  run that must self-certify its delivery. Missing LobeHub environment IDs never
  make this skill inapplicable.
---

# Verify (Builder Self-Evidence)

You are the **builder** for a delivery. A separate review step judges it against
either an existing **verify plan** or checks you author before testing. Some
criteria demand **evidence** (a screenshot, a DOM snapshot, CLI output…). A
criterion that declares `requiredEvidence` **cannot pass on your text alone**:
if the artifact is missing, the structural gate marks it `uncertain` and the
delivery is held.

## Applicability invariant

This skill applies whenever the delivery needs real verification. Environment
IDs select a path; they are not prerequisites:

- `$LOBE_OPERATION_ID` means a verify plan already exists. Discover and satisfy
  it.
- No `$LOBE_OPERATION_ID` means you author the checks and publish a structured
  report round.
- `$LOBEHUB_TOPIC_ID` or `--subject` groups rounds under an existing LobeHub
  object.
- No topic or subject means `lh acceptance run ingest` creates a standalone
  acceptance automatically.

Never report that this skill is inapplicable merely because
`$LOBE_OPERATION_ID`, `$LOBEHUB_TOPIC_ID`, or a Task ID is absent. Continue with
the standalone path.

So while you do the work, capture the proof and submit it. The loop:

```
discover or author plan  →  pick the surface  →  capture evidence  →  publish the round  →  self-check coverage
```

The skill package is portable, but execution capabilities are surface-specific:
`agent-browser` serves Web/Electron, while native macOS and iOS Simulator require
a local macOS display and their platform tools. No repository-specific scripts
or fixed report directory are required.

## Two entry points — an operation id is NOT required

Every evidence command targets a **verification session** (a round). How you
name that session is a choice, not a prerequisite:

| You have                                 | Target the round with                                                                                                     | Path                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A verify plan (`$LOBE_OPERATION_ID` set) | `--operation "$LOBE_OPERATION_ID"`                                                                                        | This document: discover the plan, satisfy its criteria |
| No plan — you author the checks          | Publish a whole directory with `lh acceptance run ingest`; it creates the round and, when needed, a standalone acceptance | [references/report.md](references/report.md)           |

`--operation` and `--run` are interchangeable on `result submit` and
`result list`; a round created without an operation is simply recorded as
`standalone`. (`evidence list` takes neither — it keys off a positional
`<checkResultId>` you read from `result list`.) **A missing operation id never
means "skip the acceptance"** — it only means you author the plan instead of
discovering it. On a later repair round, pass the previously printed
`--acceptance <acceptanceId>` so the new snapshot joins the same history.

On the first ingest, always supply `--requirement "<one-sentence business goal>"`.
The requirement describes what the whole acceptance judges, not the narrower
scope of one round. It is immutable once recorded.

## HARD RULE — programmatic gates are NEVER acceptance checks

This is a binding constraint on every check you author, enforced at ingest —
not a style preference.

Every check MUST be an outcome a **person decides about the delivery**: what
the user sees, hears, reads, or receives. The repo's own automated gates are
not that. The following MUST NOT appear as a check, in any round, under any
phrasing:

- unit / integration / regression / snapshot tests; test suites or test cases
- coverage, `type-check` / `tsc`, lint / `eslint`, format, "compiles cleanly",
  "build passes", "CI is green"

They are preconditions of shipping, and a page full of them buries the two or
three checks that actually needed a human eye. Run them — then report them as
**one line of narrative**, never as a check.

Enforcement, so plan around it rather than against it:

- `lh acceptance run ingest` **drops** every matching plan item and case and
  warns — the round publishes without them, so a gate-check wastes the effort
  spent producing it.
- A round consisting **only** of such checks **fails to publish entirely**:
  there is nothing in it for a person to accept.

The line is the _subject_ of the check, not who judged it: a CLI behavior check
asserted by a command is a good acceptance item (`verifier: "program"`);
"`bun run test` is green" is not. Before writing any plan, re-read each draft
check and ask: _would the user click accept/reject on this?_ If the honest
answer is "it's a gate", it does not go in.

## Rounds are immutable — repair means a NEW round

A published round is a permanent record of what was true at that moment. **Never
re-submit into a round to "fix" it after changing the code** — publish the
re-verification as the next round, and let the acceptance page show the
progression. Correcting a typo in the same session's report is fine; passing off
post-fix evidence as the original round is not.

Before a repair round, read the current acceptance with
`lh acceptance view <acceptanceId | type:id> --json`. Omit checks whose latest
`userReview.action` is `accept`; address non-stale rejects and reuse their exact
stable check ids. When one check semantically replaces another, declare
`supersedes: ['old-id']` and repeat the complete lineage in every later round
that reuses the successor id.

The **acceptance** (`/acceptance/<acceptanceId>`) is the stable cross-round
decision surface that aggregates every immutable round for a subject. In the
final reply, expose only the acceptance page. A fixed snapshot of the current
round uses that same path with `?r=<roundIndex>`; implementation-level run pages
stay internal.

## Prerequisites

- **`lh` is authed.** Confirm with `lh acceptance run list --json` (an empty `[]`
  means authed; an auth error means stop and surface it).
- **A round path.** Use `$LOBE_OPERATION_ID` when supplied. Otherwise author a
  structured report; ingest creates both its round and, outside LobeHub, its
  standalone acceptance.
- **Install only the UI driver required by the selected surface.** Web/Electron
  use `agent-browser`; native iOS uses Xcode/`simctl` plus a Simulator HID/AX CLI
  such as AXe, or the repository's existing UI-test driver. Probe installed tools
  before adding dependencies, and do not substitute a private agent plugin.

## Step 1 — Discover the plan (what to prove)

> Plan-driven path only. Authoring your own checks instead? Apply the
> [hard rule](#hard-rule--programmatic-gates-are-never-acceptance-checks) to
> every check you write, then jump to
> [references/report.md](references/report.md) and use the relevant surface
> recipes below to capture its evidence. Publish that authored plan and its
> cases together with `lh acceptance run ingest`.

One read tells you what to prove:

```bash
lh verify plan state "$LOBE_OPERATION_ID" --json
```

Each `verifyPlan[]` item carries `id` (the **checkItemId**), `title`, `required`,
and `verifierConfig.requiredEvidence` (`[{ type, hint }]` — the artifacts you MUST
capture). The `checkItemId` is the only handle you need: `lh acceptance run result submit` (Step 3)
keys off it plus your operation id and creates the result row for you, so you do
**not** need a `checkResultId` up front. (Result rows generally don't exist yet at
this point — that's expected.) Exact shapes:
[references/plan-format.md](references/plan-format.md).

> Only items with a non-empty `requiredEvidence` need an artifact. Items without
> it are judged on the deliverable text alone — don't fabricate evidence.

## Step 2 — Pick the surface by what you changed

The criterion's `hint` usually implies the surface. Match the change you made to
the cheapest surface that can actually prove it, and escalate only if needed:

| What your task changed                                         | Surface                                               | Why                                                                                            | Guide                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Backend / CLI / library / data logic                           | **CLI**                                               | Fastest, text-assertable, zero UI flakiness — upload stdout as `text`                          | [surfaces/cli.md](surfaces/cli.md)                     |
| Web app frontend / styles / interactions                       | **Web** (agent-browser → running web app)             | The product shape users see; screenshot/DOM the rendered result                                | [surfaces/web.md](surfaces/web.md)                     |
| New/changed API **plus** the UI consuming it                   | **Web**, full-stack (agent-browser + network capture) | One surface where request/response and rendered result are both observable                     | [surfaces/web.md](surfaces/web.md#web-full-stack)      |
| Desktop (Electron) app behavior                                | **Electron** (agent-browser `--cdp`)                  | Only the real desktop shell exercises desktop-only code paths                                  | [surfaces/electron.md](surfaces/electron.md)           |
| Native macOS app / OS-level behavior agent-browser can't reach | **Native** (Computer Use: osascript + screencapture)  | The only way to drive non-Chromium apps and OS chrome (local macOS only)                       | [surfaces/native.md](surfaces/native.md)               |
| Native iOS app behavior, gestures, or device-size layout       | **iOS Simulator** (AXe/native CLI + `simctl`)         | Proves the installed iOS binary, native HID input, Accessibility state, and device framebuffer | [surfaces/ios-simulator.md](surfaces/ios-simulator.md) |

Rules of thumb:

- **Don't open a browser for a backend change.** If a criterion is satisfied by a
  command's output, capture that as `text` — it's the strongest, cheapest proof.
- **A deliverable the user hears needs `audio`.** TTS output, a voice reply, an
  alert tone: upload the clip itself so the page renders a player. Prose about a
  sound, or a screenshot of a waveform, proves nothing.
  See [references/evidence.md](references/evidence.md#audio-deliverables).
- **Web vs Electron:** use **web** when the behavior is identical in a normal
  browser against the app's dev server or deployed URL. Use **Electron** only when
  the criterion depends on desktop-only behavior (native windows, IPC, the
  packaged shell, OS integration) — that code path doesn't exist in a plain web
  page. Switching conditions per surface: [surfaces/web.md](surfaces/web.md) and
  [surfaces/electron.md](surfaces/electron.md).
- **iOS is not a browser or host-mouse surface.** Use AXe or another installed
  Simulator HID/Accessibility CLI for taps, long press, swipe, pan, and UI-tree
  inspection; use `simctl` for lifecycle/framebuffer capture. If the available
  CLI cannot express the planned touch sequence, mark the case `blocked`.
- **Auth is a gate, scoped to the surface.** If the state under test is behind a
  login, authenticate that surface first or every capture lands on the sign-in
  page. Follow the selected surface's Auth section; load
  [references/auth-web.md](references/auth-web.md) only for a Web session.

## Step 3 — Capture, then submit each artifact

Capture each required `type` with the selected surface guide, then apply the
shared artifact rules in [references/evidence.md](references/evidence.md) and
submit one artifact per call with the criterion's `checkItemId`.
`lh acceptance run result submit` resolves your session from the operation id,
lazily creates/updates the result row, and attaches the evidence — one call, no
`checkResultId` needed:

```bash
# CHECK_ITEM_ID is the plan item id for this criterion (from Step 1).
# file artifact already captured by the selected surface
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" \
  --type "$EVIDENCE_TYPE" --file "$ARTIFACT_PATH" --by "$PROVENANCE" \
  --desc "Observed state after the planned action"

# inline text artifact (stdout / computed value) — no file
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" \
  --type text --content "$(your-cli command --json)" --by cli \
  --desc "command reports success after the change"
```

`--by` records provenance: `agent-browser` | `cdp` | `cli` | `program`. Use
`--file` for binaries, `--content` for text — exactly one. Submit one artifact per
call; call again for each additional one (same `--item` reuses the row). Leave the
pass/fail **verdict** to the review step — only add `--verdict` if your task
explicitly asks you to self-assert the outcome. Every successful submit prints the
an internal run URL. Keep the returned run id only for coverage checks; never
expose that URL in the final handoff.

## Step 4 — Self-check coverage (do not skip)

Before you declare the task done, prove every required artifact landed. For each
criterion with `requiredEvidence`, list what you submitted and confirm each `type`
is present. After submitting, the result rows exist, so map each `checkItemId` to
its `checkResultId` and list that row's evidence:

```bash
lh acceptance run result list --operation "$LOBE_OPERATION_ID" --json # checkItemId → checkResultId
lh acceptance run evidence list "$CHECK_RESULT_ID" --json
```

Coverage rule: for each required criterion, **every** `requiredEvidence[].type`
must appear at least once in its evidence list. Report it explicitly, e.g.
`coverage: 2/2 criteria, all required evidence uploaded`. If a type is missing, go
back to Step 3 — a missing artifact holds the delivery at `uncertain` no matter
how good the work is.

### Final handoff (mandatory)

The final response MUST include the published acceptance URL when the round is
attached to an acceptance, together with the explicit coverage result. Do not
finish with only a check-result id or prose claim.

Expose only the **acceptance** link — it is the stable cross-round decision
surface. For this round's fixed snapshot, append `?r=<roundIndex>` to that same
URL. Put no images, local paths, local file links, or internal run-page paths in
the chat reply.

```text
Acceptance:   https://app.lobehub.com/acceptance/<acceptanceId>
Coverage: 2/2 criteria, all required evidence uploaded
```

## Portability rules

- **Prefer engine-level capture over OS capture.** `agent-browser screenshot` /
  `dom` / `eval` render from the browser engine and run headless; `screencapture`
  / osascript are macOS-only and break in the cloud. For iOS Simulator, prefer
  its own framebuffer via `xcrun simctl io` over host-window capture.
- **Upload as you go, not at the end.** Evidence uploaded mid-run is keyed to the
  criterion immediately; a crash near the end doesn't lose your proof.
- **Don't invent evidence.** Only capture the types a criterion declares.
  Over-uploading noise makes the review harder, not easier.

## Reference map

Load detailed references only after selecting the applicable path:

| Need                                                   | Reference                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| Existing verify-plan schema and join keys              | [plan-format.md](references/plan-format.md)                         |
| Shared media, provenance, submission, and safety rules | [evidence.md](references/evidence.md)                               |
| Authored structured rounds and `result.json`           | [report.md](references/report.md)                                   |
| Web/Electron Chromium CLI commands                     | [agent-browser.md](references/agent-browser.md)                     |
| Authenticated Web session                              | [auth-web.md](references/auth-web.md)                               |
| Native macOS or OS-owned step                          | [computer-use.md](references/computer-use.md)                       |
| Web/Electron temporal evidence                         | [recording-cdp.md](references/recording-cdp.md)                     |
| iOS Simulator temporal/frame evidence                  | [recording-ios-simulator.md](references/recording-ios-simulator.md) |
| Native macOS temporal evidence                         | [recording-native-macos.md](references/recording-native-macos.md)   |
