---
name: acceptance
description: >
  Self-evidence for task delivery verification. When you run a task that has a
  verify plan, this skill is the full operating manual: what to prove, which
  surface to prove it on (CLI / web / desktop), how to drive that surface with
  agent-browser, how to get past auth, and how to submit each artifact with
  `lh acceptance run result submit` so the delivery is judged on real proof — not your
  word that it works. Triggers on 'verify the task', 'collect evidence', 'prove
  it works', 'upload evidence', 'verify plan', 'requiredEvidence', or any run
  that must self-certify its delivery.
---

# Verify (Builder Self-Evidence)

You are the **builder** for a task. A separate review step will judge your
delivery against a **verify plan** — a list of criteria, some of which demand
**evidence** (a screenshot, a DOM snapshot, CLI output…). A criterion that
declares `requiredEvidence` **cannot pass on your text alone**: if the artifact
is missing, the structural gate marks it `uncertain` and the delivery is held.

So while you do the work, capture the proof and submit it. The loop:

```
discover plan  →  pick the surface  →  capture evidence per criterion  →  submit each  →  self-check coverage
```

Everything here is portable: the hard dependencies are the `lh` CLI (already
authed in your environment) and, for UI proof, `agent-browser`. No repo scripts,
no local report directory.

## Prerequisites

- **`lh` is authed.** Confirm with `lh acceptance run list --json` (an empty `[]`
  means authed; an auth error means stop and surface it).
- **You know your operation id.** It is provided as `$LOBE_OPERATION_ID` in the
  environment (or named in your task prompt). Every command below keys off it.
  If it is unset, there is no plan to satisfy — skip this skill.
- **For UI evidence, `agent-browser` is installed.** `npm i -g agent-browser`
  then `agent-browser install` (downloads Chrome). Full reference:
  [references/agent-browser.md](references/agent-browser.md).

## Step 1 — Discover the plan (what to prove)

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

| What your task changed                                         | Surface                                               | Why                                                                        | Guide                                             |
| -------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Backend / CLI / library / data logic                           | **CLI**                                               | Fastest, text-assertable, zero UI flakiness — upload stdout as `text`      | [surfaces/cli.md](surfaces/cli.md)                |
| Web app frontend / styles / interactions                       | **Web** (agent-browser → running web app)             | The product shape users see; screenshot/DOM the rendered result            | [surfaces/web.md](surfaces/web.md)                |
| New/changed API **plus** the UI consuming it                   | **Web**, full-stack (agent-browser + network capture) | One surface where request/response and rendered result are both observable | [surfaces/web.md](surfaces/web.md#web-full-stack) |
| Desktop (Electron) app behavior                                | **Electron** (agent-browser `--cdp`)                  | Only the real desktop shell exercises desktop-only code paths              | [surfaces/electron.md](surfaces/electron.md)      |
| Native macOS app / OS-level behavior agent-browser can't reach | **Native** (Computer Use: osascript + screencapture)  | The only way to drive non-Chromium apps and OS chrome (local macOS only)   | [surfaces/native.md](surfaces/native.md)          |

Rules of thumb:

- **Don't open a browser for a backend change.** If a criterion is satisfied by a
  command's output or a test passing, capture that as `text` — it's the strongest,
  cheapest proof.
- **Web vs Electron:** use **web** when the behavior is identical in a normal
  browser against the app's dev server or deployed URL. Use **Electron** only when
  the criterion depends on desktop-only behavior (native windows, IPC, the
  packaged shell, OS integration) — that code path doesn't exist in a plain web
  page. Switching conditions per surface: [surfaces/web.md](surfaces/web.md) and
  [surfaces/electron.md](surfaces/electron.md).
- **Auth is a gate, scoped to the surface.** If the state under test is behind a
  login, authenticate that surface first or every capture lands on the sign-in
  page. Recipes and boundaries: [references/auth.md](references/auth.md).

## Step 3 — Capture, then submit each artifact

Capture each required `type` (recipes per surface in
[references/evidence.md](references/evidence.md)), then submit one artifact per
call with the criterion's `checkItemId`. `lh acceptance run result submit` resolves your session
from the operation id, lazily creates/updates the result row, and attaches the
evidence — one call, no `checkResultId` needed:

```bash
# CHECK_ITEM_ID is the plan item id for this criterion (from Step 1).
# file artifact (screenshot / dom / video)
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" \
  --type screenshot --file ./proof/login.png --by agent-browser \
  --desc "Logged-in home renders the workspace switcher"

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
full `/verify/<verifyRunId>` report URL. Preserve that URL for the final handoff.

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

The final response MUST include the full report URL printed by
`lh acceptance run result submit`, together with the explicit coverage result.
Do not finish with only a check-result id, local artifact path, or prose claim.

```text
Verification report: https://app.lobehub.com/verify/<verifyRunId>
Coverage: 2/2 criteria, all required evidence uploaded
```

## Worked example (web criterion, one screenshot)

Plan item: _"Settings page shows the new 'Beta features' toggle"_,
`requiredEvidence: [{ type: screenshot }]`, `required: true`.

```bash
OP="$LOBE_OPERATION_ID"

# 1. discover: find this item's checkItemId + required evidence
lh verify plan state "$OP" --json # → item id vci_settings, requires screenshot

# 2. surface = web (frontend change). Auth the session if needed (see references/auth.md).
agent-browser --session app open "http://localhost:3000/settings"
agent-browser --session app wait --text "Beta features"
agent-browser --session app screenshot ./proof/settings-beta.png

# 3. submit: creates the result row + attaches the screenshot in one call
lh acceptance run result submit --operation "$OP" --item vci_settings --type screenshot \
  --file ./proof/settings-beta.png --by agent-browser \
  --desc "Settings page renders the new Beta features toggle"
# → report: https://app.lobehub.com/verify/<verifyRunId>

# 4. self-check
lh acceptance run result list --operation "$OP" --json # → { checkItemId: vci_settings, id: vcr_77 }
lh acceptance run evidence list vcr_77 --json          # → one screenshot present → 1/1 covered
```

## Portability rules

- **Prefer engine-level capture over OS capture.** `agent-browser screenshot` /
  `dom` / `eval` render from the browser engine and run headless; `screencapture`
  / osascript are macOS-only and break in the cloud.
- **Upload as you go, not at the end.** Evidence uploaded mid-run is keyed to the
  criterion immediately; a crash near the end doesn't lose your proof.
- **Don't invent evidence.** Only capture the types a criterion declares.
  Over-uploading noise makes the review harder, not easier.

## Reference map

```
verify/
├── SKILL.md                      # this router: the loop + surface decision + example
├── surfaces/                     # per-surface acceptance recipes — pick one per criterion
│   ├── cli.md                    # backend / CLI surface → text evidence from command output
│   ├── web.md                    # web surface (frontend / full-stack) via agent-browser
│   ├── electron.md               # desktop surface (Electron) via agent-browser --cdp
│   └── native.md                 # native macOS app / OS-level surface via Computer Use
└── references/                   # cross-surface shared knowledge
    ├── plan-format.md            # verify contract: plan shape + checkItemId↔checkResultId join
    ├── evidence.md               # evidence type → capture recipe; upload; coverage; portability
    ├── agent-browser.md          # full agent-browser CLI reference (any Chromium app)
    ├── computer-use.md           # macOS Computer Use toolkit (osascript + screencapture)
    ├── recording.md              # GIF / MP4 recording for time-based evidence
    └── auth.md                   # portable auth: session/state/vault/cookie injection + boundaries
```
