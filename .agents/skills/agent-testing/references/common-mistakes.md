# Common Mistakes

> **Mandatory**: read this file in full before every agent-testing run and
> self-check against each case.
> When the user gives any negative feedback, append it here as a new case —
> each with: Wrong approach / Why it's wrong / What it breaks / Correct approach.

---

## Case 1 — Judging `passed` from heuristics instead of looking at the screenshot

**Wrong approach**: after navigating to a surface, deciding "renders fine /
passed" from only `document.body.innerText` keyword greps +
`document.querySelectorAll('[class*=Skeleton]').length === 0`, without ever
opening the screenshot.

**Why it's wrong**:

- The persistent left nav / layout-shell text is always in the DOM, so an
  innerText grep almost always false-positives.
- A blank / white page also has 0 skeletons, so `skeletons === 0` cannot tell
  "rendered successfully" from "rendered blank".

**What it breaks**: publishes a **false `passed`**. This run's `/page`
screenshot was actually a blank page (just the LobeHub watermark +
`Debug ID: Desktop > Main > Layout`), yet was reported as "renders fine, proves
removing the dead Suspense didn't break rendering" — hiding a possible real
regression and misleading the reviewer/user.

**Correct approach**: every screenshot destined for a report `evidence` **must
first be opened with the Read tool and visually confirmed to render the expected
content** before pass/fail. grep / counts are supporting signals only, never the
verdict. A blank page / watermark / layout-shell-only = fail or uncertain — go
find the root cause.

---

## Case 2 — Goal is verifying error states, but stopping at happy-path because injection is hard

**Wrong approach**: after `network route --abort`, `window.fetch` override, and
`set offline` all failed to force a fetch failure, giving up on the error-state
screenshots and shipping only happy-path + unit tests, marking the core goal
uncertain/blocked.

**Why it's wrong**: the **entire point** of the task was verifying every error
state. Abandoning that core goal = task not done. Worse, I had already written
down viable alternatives (CDP `Network.setBlockedURLs`, server-side fault
injection) but stopped without executing them.

**What it breaks**: the deliverable doesn't cover what the user actually asked
for — a wasted round that needs redoing.

**Correct approach**: **do not stop until the core goal is met**. When the first
batch of methods fails, immediately switch to the next known-working one. For
this app's TRPC the working method is **client-service fetcher instrumentation
via HMR** (throw an error with `data.httpStatus`) or server-side fault
injection — get the **real failure-state screenshot** before writing the report.
See `probe-mock-patterns.md` for the full working recipes.

---

## Case 3 — Deriving the task from commit messages / branch name instead of the actual ask

**Wrong approach**: on a resumed session with lost prior context, reading the
branch name (`fix/hetero-callback-signal-metadata`) and top commits (signal
metadata + Monitor re-enable) and concluding _that_ was the thing to verify —
then spinning up a whole Monitor E2E — when the user's real task (" 异构 Agent
消息块转发功能缺失 ") was an entirely different feature (message multi-select /
forward not exposed on hetero agents). Made the user say "你是丢失上下文了吗？"
and "你理解错了" twice.

**Why it's wrong**: a branch's committed work is not necessarily the current
ask. When context was summarized/lost, the commit history is a _hypothesis_, not
the task. The task lives in the user's words.

**What it breaks**: burned a full Monitor test run + two rounds of clarifying
questions on the wrong feature before course-correcting.

**Correct approach**: when the user references a task you don't have in context,
say so plainly and RECOVER it before acting — check `.records/reports/` for
prior sessions on this branch, read the live conversation's own messages (the
desktop app persists them; the very first user turn is usually the task), or ask
for a pointer. Only translate the ask into code/commits after it's grounded.
Note: the LobeHub desktop app conversation you're driving may BE the host session
running you — its message list is the source of truth for what was asked.

---

## Case 4 — Asserting a capture/tooling root cause from plausibility instead of measuring it

**Wrong approach**: when a screenshot came out black and CDP capture failed, I
declared root causes from what "sounded right" and published them: first
"terminal lacks Screen Recording permission" (put it in the shipped report), then
"CDP is immune to display sleep", then the opposite "headful CDP stalls when the
display sleeps". Each was stated before running the experiment.

**Why it's wrong**: every one was falsifiable in seconds and most were wrong.
`CGPreflightScreenCaptureAccess` returned _granted_; a pixel probe showed the black
frame was **display sleep**, not permission; a raw-CDP A/B (display asleep, window
minimized) showed CDP capture works fine in both — so the real cause was the
agent-browser daemon wedging (D5), not sleep at all.

**What it breaks**: a **published report with a wrong root cause**, plus wasted
round-trips flip-flopping and having to retract each claim.

**Correct approach**: for any capture / permission / timing / "environment"
failure, **reproduce and measure before asserting or publishing** — pixel
brightness (mean/max) for blackness, `CGPreflightScreenCaptureAccess` for the TCC
bit, an A/B with the variable toggled (display asleep vs awake; window normal vs
minimized) to isolate the cause. State "confirmed by X" vs "suspected", and never
ship a root cause into a report that a one-line probe could have checked.

---

## Case 5 — Attaching the stale "before" screenshot as a passed case's evidence (unlabeled)

**Wrong approach**: after verifying a UI change on the live-code instance, I put
BOTH the "after" (live) and the "before" (stale-build) screenshots into the same
`cases[].evidence` array, unlabeled. The verify page renders every evidence image
with its filename as a heading, so the user opened `01-drag-overlay.png` /
`02-switcher-popover.png` (the STALE shots) and saw the old 28px gap + Apple logo —
concluding "还是没贴边 / 还是 Apple logo, 你没改啊".

**Why it's wrong**: a passed case's evidence must show the PASSING (after) state.
An unlabeled before-shot sitting next to it reads as "the current result", making a
correct fix look broken. Filenames are not captions — the viewer can't tell
before from after.

**What it breaks**: the user reads a green/passed report as a failure, loses trust,
and it takes another round to re-explain.

**Correct approach**: never ship a raw stale/before screenshot as standalone
evidence. If a contrast helps, build ONE labeled before→after composite (e.g. sharp:
crop the region from each, add a "BEFORE …/AFTER …" header bar, place side by side)
and attach that single image. Evidence for a passed case = the after state (or a
clearly-labeled comparison), full stop.

## Case 6 — `app://renderer` desktop instance runs the STALE built bundle, not working-tree code

**Wrong approach**: driving the already-running desktop app on CDP 9222 (URL
`app://renderer/…`) to verify a working-tree UI change, and eyeballing the first
screenshot as "looks changed".

**Why it's wrong**: the resident desktop app serves a BUILT renderer snapshot — it
does not reflect uncommitted/HMR src changes. The measured `::before` inset was
still 28px (old) even though the code said 10px. Eyeballing nearly passed it.

**What it breaks**: verifying against code that isn't your change → a false pass (or
false fail), on the wrong bundle entirely.

**Correct approach**: to verify working-tree UI in the desktop shape, start an
isolated dev instance that loads live code — `electron-dev.sh start <id>` runs
`electron-vite dev` (its own CDP/Vite, copied login), which DOES bundle your src
changes. Prove it's live by MEASURING a known-changed value (e.g. computed
`::before` inset 10px vs old 28px) before trusting any screenshot. Don't kill the
user's resident 9222 app — use a pool id. Also: `agent-browser open` mangles
`app://` → `https://app//…` (ERR\_CONNECTION\_CLOSED); navigate inside the SPA by
clicking its own `<a href>` links, not `open`.

## Case 7 — Embedding a local-path screenshot in the chat reply (broken-image placeholder)

**Wrong approach**: ending the final reply with an inline image embed pointing at
the report dir — `![caption](.records/reports/<ts>-<slug>/assets/06-foo.png)` —
believing a leading `!` makes it render as a picture in chat.

**Why it's wrong**: the chat UI can't load a local filesystem path. The embed
renders as an empty grey broken-image box (the user sees a placeholder + " 完全
看不了图内容 "), and the plain-link form `[Image](…local…png)` is an un-openable
dead link. Local report paths only resolve on the machine, never inside the
message. The earlier guidance that said "if a visual helps, embed it as an image,
not a link" was itself wrong and has been removed.

**What it breaks**: the reply looks like it has evidence but shows nothing —
the user gets a broken box instead of the screenshot, and has to go find the
verify link anyway.

**Correct approach**: put NO images and NO local-file links in the chat reply.
The published `https://app.lobehub.com/verify/<id>` page already renders every
screenshot inline — that URL is the only visual deliverable. Describe key visual
outcomes in prose; mention the local report dir as a plain string (not a
markdown link) if a reference is useful.
