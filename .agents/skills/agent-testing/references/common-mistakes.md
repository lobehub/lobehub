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

## Case 5 — (placeholder) append the user's next negative feedback below

<!-- New case template:
## Case N — one-line summary of the mistake
**Wrong approach**: …
**Why it's wrong**: …
**What it breaks**: …
**Correct approach**: …
-->
