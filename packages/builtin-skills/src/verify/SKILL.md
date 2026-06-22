---
name: verify
description: >
  Self-evidence for task delivery verification. When you run a task that has a
  verify plan, this skill is the full operating manual: what to prove, which
  surface to prove it on (CLI / web / desktop), how to drive that surface with
  agent-browser, how to get past auth, and how to upload each artifact with
  `lh verify upload-evidence` so the delivery is judged on real proof — not your
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

So while you do the work, capture the proof and upload it. The loop:

```
discover plan  →  pick the surface  →  capture evidence per criterion  →  upload each  →  self-check coverage
```

Everything here is portable: the hard dependencies are the `lh` CLI (already
authed in your environment) and, for UI proof, `agent-browser`. No repo scripts,
no local report directory.

## Prerequisites

- **`lh` is authed.** Confirm with `lh verify run list --json` (an empty `[]`
  means authed; an auth error means stop and surface it).
- **You know your operation id.** It is provided as `$LOBE_OPERATION_ID` in the
  environment (or named in your task prompt). Every command below keys off it.
  If it is unset, there is no plan to satisfy — skip this skill.
- **For UI evidence, `agent-browser` is installed.** `npm i -g agent-browser`
  then `agent-browser install` (downloads Chrome). Full reference:
  [references/agent-browser.md](references/agent-browser.md).

## Step 1 — Discover the plan (what to prove + where to attach)

Two reads, joined by `checkItemId`:

```bash
# (a) the frozen plan: each item's id, title, and required evidence types
lh verify plan state "$LOBE_OPERATION_ID" --json

# (b) the pending result rows: maps each checkItemId → checkResultId (the upload handle)
lh verify result list --operation "$LOBE_OPERATION_ID" --json
```

From (a), each `verifyPlan[]` item carries `id` (the **checkItemId**), `title`,
`required`, and `verifierConfig.requiredEvidence` (`[{ type, hint }]` — the
artifacts you MUST capture). From (b), each row gives `checkItemId` → `id` (the
**checkResultId** you upload against). Join them so you have, per criterion: the
evidence types required and the checkResultId to attach them to. Exact shapes and
a worked join: [references/plan-format.md](references/plan-format.md).

> Only items with a non-empty `requiredEvidence` need an artifact. Items without
> it are judged on the deliverable text alone — don't fabricate evidence.

## Step 2 — Pick the surface by what you changed

The criterion's `hint` usually implies the surface. Match the change you made to
the cheapest surface that can actually prove it, and escalate only if needed:

| What your task changed                                         | Surface                                                  | Why                                                                        | Guide                                             |
| -------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Backend / CLI / library / data logic                           | **CLI** 端                                               | Fastest, text-assertable, zero UI flakiness — upload stdout as `text`      | [surfaces/cli.md](surfaces/cli.md)                |
| Web app frontend / styles / interactions                       | **Web** 端 (agent-browser → running web app)             | The product shape users see; screenshot/DOM the rendered result            | [surfaces/web.md](surfaces/web.md)                |
| New/changed API **plus** the UI consuming it                   | **Web** 端，full-stack (agent-browser + network capture) | One surface where request/response and rendered result are both observable | [surfaces/web.md](surfaces/web.md#web-full-stack) |
| Desktop (Electron) app behavior                                | **Electron** 端 (agent-browser `--cdp`)                  | Only the real desktop shell exercises desktop-only code paths              | [surfaces/electron.md](surfaces/electron.md)      |
| Native macOS app / OS-level behavior agent-browser can't reach | **Native** 端 (Computer Use: osascript + screencapture)  | The only way to drive non-Chromium apps and OS chrome (local macOS only)   | [surfaces/native.md](surfaces/native.md)          |

Rules of thumb:

- **Don't open a browser for a backend change.** If a criterion is satisfied by a
  command's output or a test passing, capture that as `text` — it's the strongest,
  cheapest proof.
- **Web vs Electron:** use **web** when the behavior is identical in a normal
  browser against the app's dev server or deployed URL. Use **Electron** only when
  the criterion depends on desktop-only behavior (native windows, IPC, the
  packaged shell, OS integration) — that code path doesn't exist in a plain web
  page. Switching conditions per 端: [surfaces/web.md](surfaces/web.md) and
  [surfaces/electron.md](surfaces/electron.md).
- **Auth is a gate, scoped to the 端.** If the state under test is behind a
  login, authenticate that 端 first or every capture lands on the sign-in
  page. Recipes and boundaries: [references/auth.md](references/auth.md).

## Step 3 — Capture, then upload each artifact

Capture each required `type` (recipes per surface in
[references/evidence.md](references/evidence.md)), then upload one artifact per
call, attached to the criterion's `checkResultId`:

```bash
# CHECK_RESULT_ID is the checkResultId for this criterion (from Step 1).
# file artifact (screenshot / dom / video)
lh verify evidence upload --check "$CHECK_RESULT_ID" --type screenshot \
  --file ./proof/login.png --by agent-browser \
  --desc "Logged-in home renders the workspace switcher"

# inline text artifact (stdout / computed value) — no file
lh verify evidence upload --check "$CHECK_RESULT_ID" --type text \
  --content "$(your-cli command --json)" --by cli \
  --desc "command reports success after the change"
```

`--by` records provenance: `agent-browser` | `cdp` | `cli` | `program`. Use
`--file` for binaries, `--content` for text — exactly one of them.

## Step 4 — Self-check coverage (do not skip)

Before you declare the task done, prove every required artifact landed. For each
criterion with `requiredEvidence`, list what you uploaded and confirm each `type`
is present:

```bash
lh verify evidence list "$CHECK_RESULT_ID" --json
```

Coverage rule: for each required criterion, **every** `requiredEvidence[].type`
must appear at least once in its evidence list. Report it explicitly, e.g.
`coverage: 2/2 criteria, all required evidence uploaded`. If a type is missing, go
back to Step 3 — a missing artifact holds the delivery at `uncertain` no matter
how good the work is.

## Worked example (web criterion, one screenshot)

Plan item: _"Settings page shows the new 'Beta features' toggle"_,
`requiredEvidence: [{ type: screenshot }]`, `required: true`.

```bash
OP="$LOBE_OPERATION_ID"

# 1. discover: find this item's checkResultId
lh verify plan state "$OP" --json              # → item id vci_settings, requires screenshot
lh verify result list --operation "$OP" --json # → { checkItemId: vci_settings, id: vcr_77 }

# 2. 端 = web (frontend change). Auth the session if needed (see references/auth.md).
agent-browser --session app open "http://localhost:3000/settings"
agent-browser --session app wait --text "Beta features"
agent-browser --session app screenshot ./proof/settings-beta.png

# 3. upload against the handle
lh verify evidence upload --check vcr_77 --type screenshot \
  --file ./proof/settings-beta.png --by agent-browser \
  --desc "Settings page renders the new Beta features toggle"

# 4. self-check
lh verify evidence list vcr_77 --json # → one screenshot present → 1/1 covered
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
├── SKILL.md                      # this router: the loop + 端 decision + example
├── surfaces/                     # 不同端的验收方案 — pick one per criterion
│   ├── cli.md                    # backend / CLI 端 → text evidence from command output
│   ├── web.md                    # web 端 (frontend / full-stack) via agent-browser
│   ├── electron.md               # desktop 端 (Electron) via agent-browser --cdp
│   └── native.md                 # native macOS app / OS-level 端 via Computer Use
└── references/                   # 跨端共享知识
    ├── plan-format.md            # verify contract: plan shape + checkItemId↔checkResultId join
    ├── evidence.md               # evidence type → capture recipe; upload; coverage; portability
    ├── agent-browser.md          # full agent-browser CLI reference (any Chromium app)
    ├── computer-use.md           # macOS Computer Use toolkit (osascript + screencapture)
    ├── recording.md              # GIF / MP4 recording for time-based evidence
    └── auth.md                   # portable auth: session/state/vault/cookie injection + boundaries
```
