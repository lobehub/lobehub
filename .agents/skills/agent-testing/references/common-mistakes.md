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

## Case 8 — Asking the user "how should I run this?" instead of defaulting to an isolated full run

**Wrong approach**: when a visual/screenshot request needs an isolated env (app
must run the feature branch, not the working dir's current branch; a background
process owns the shared checkout; the surface needs fixture data like a git repo
with 2 worktrees), stopping to ask the user which approach to take — full
isolated run vs a lighter HMR shot vs a static prototype — via a plan-approval
question.

**Why it's wrong**: the user's standing preference is that **agent-testing
DEFAULTS to a full isolated-environment screenshot/recording run that ends in a
published verify report** — "time is not a concern; solve the env problems
yourself." Presenting environment difficulty as a menu of shortcuts pushes setup
decisions back onto the user that the skill is supposed to own.

**What it breaks**: wastes a round on a question the user doesn't want, and
signals the agent will cut corners on fidelity when the env is inconvenient.

**Correct approach**: for any "run it and show me" request, go straight to the
**isolated full run** by default — spin up a dedicated worktree + dev instance on
the feature branch (never disturb the user's running app or the branch a
background process holds), build whatever fixture data the surface needs (create a
throwaway git repo, `git worktree add` a second tree, point a fresh conversation's
working directory at it, etc.), capture the real rendered screenshot/GIF, verify
it by opening the PNG, and publish the `/verify` report. Only surface a
plan-approval question when the _product decision_ is ambiguous (what to test),
never for _environment mechanics_ (how to render it). Env obstacles are the
skill's job to solve and then iterate back into these logs.

---

## Case 9 — Self-judging a screenshot as "too costly" and asking the user to picture the result

**Wrong approach**: after a small user-facing UI change (a padding tweak), skipping
the rendered screenshot with "it's a trivial style change; restarting Electron to
screenshot costs more than the change is worth — tell me if you want one." I decided
the cost/benefit for the user and shipped a diff they had to picture in their head.

**Why it's wrong**: whether a verification artifact is "worth it" is **not mine to
decide**. The measuring stick is _whether the user can conveniently inspect the
product_, not how much effort _I_ spend rendering it. Making the user guess the visual
effect from a code diff is the actually-expensive outcome.

**What it breaks**: the user can't check the deliverable, loses trust, and has to push
back (" 成本高不高不是你自己说了算，而是用户是否方便检查产物作为衡量标准。你让用户猜效果
这个成本才高，别瞎揣测和偷懒 ") — burning a round to get the screenshot I should have
produced up front.

**Correct approach**: for ANY user-facing change (even one line of padding/color),
default to rendering it and attaching the screenshot to the verify report as a record
point — open the PNG to confirm, publish. Never offer the screenshot as an opt-in
("want me to screenshot?"); just produce it. Env/restart cost is the skill's job to
absorb, not a reason to shift the checking burden onto the user.

---

## Case 10 — Reporting a UI-touching change with only CLI transcripts and no screenshot

**Wrong approach**: when a change includes visible UI copy/badges/alerts, treating
the run as purely backend/service validation and publishing only command-output
evidence, then calling it a complete agent-testing report.

**Why it's wrong**: CLI transcripts prove code paths and tests passed, but they do
not let the reviewer inspect the actual rendered UI. If the feature changed a
channel page alert or badge, the report needs at least one screenshot evidence item
for that visible state.

**What it breaks**: the user opens the report expecting visual proof and asks
"没截图吗？", because the report cannot show whether the UI looks correct.

**Correct approach**: if any UI surface changed, include a visual case in the same
verify run. Either drive the real app UI with agent-browser/Electron/Web and attach
a screenshot, or explicitly mark the UI screenshot case blocked with the measured
environment blocker. Do not present a UI-touching report as complete with only CLI
evidence.

## Case 11 — Skipping the agent-testing entry point for a UI E2E check

**Wrong approach**: after implementing a user-facing Markdown/chat interaction,
running generic local checks and an ad-hoc browser probe without first reading and
following the repo's `agent-testing` skill. The user had to ask why the test plan
did not use the dedicated skill.

**Why it's wrong**: `agent-testing` encodes LobeHub-specific surface choice, auth,
isolated Electron dev instances, screenshot evidence rules, reporting, and known
tooling traps. Bypassing it makes the validation weaker even when individual unit
tests pass.

**What it breaks**: the run can stop at DOM/text heuristics, use the wrong app
surface, miss required screenshot/report evidence, or fail to publish a verify
report that the user can inspect.

**Correct approach**: for any local end-to-end or manual verification task,
especially UI-facing changes, start with `agent-testing`: read this file and
`probe-mock-patterns.md`, resolve the test env, choose the correct surface, run
the app-specific probes, capture visually confirmed evidence, publish the verify
report, and tear down processes started by the run.

## Case 12 — Verifying the selection chip but not the final model payload

**Wrong approach**: after adding a chat text-selection action, marking the feature
verified because the floating toolbar appeared, the selected-text chip rendered,
and the UI store contained a `contextSelections` entry — without checking the
final message payload that the model receives.

**Why it's wrong**: UI metadata can be saved and displayed while a later
context-engine/runtime gate drops it before request construction. In this case,
the user bubble showed the selected text, but the Anthropic request only carried
the raw user question because generic `contextSelections` were gated behind page
editor context injection.

**What it breaks**: ships a feature that looks successful in the chat UI but has
no effect on model behavior; the user must inspect DevTools to discover the
selected context never reached the assistant.

**Correct approach**: for any feature that claims to "inject" context, verify the
last mile: add or run an integration-level assertion against the transformed
messages/request body (e.g. `MessagesEngine` output or transport payload), and
only treat the UI chip/store as supporting evidence.

---

## Case 13 — GIF evidence ending on an expected-failure frame reads as "the page failed to load"

**Wrong approach**: for a loading-skeleton case, attaching a GIF that records the
full timeline — skeleton (the asserted state) followed by the error page that the
test data inevitably produces (fake ids / dummy provider keys mean the route can
only end in its error state). The GIF loops and rests on its final frames, so the
viewer opens the report and sees the error card, not the skeleton.

**Why it's wrong**: same trap as Case 5 (unlabeled before-shot) in time-based
form — the LAST frame of a GIF is its de-facto headline. An expected-failure
terminal state without explanation reads as the case failing (" 这里怎么加载失败
了 "), even when the asserted behavior (the skeleton) passed.

**What it breaks**: the user reads a passed case as a load failure and a round is
burned re-explaining the evidence.

**Correct approach**: trim evidence to the asserted state — end the GIF on the
skeleton/loading phase (cut the frames after the terminal state appears), or
attach the static shot of the asserted state as the primary evidence. If the
expected-failure terminal state is worth showing, say so explicitly in the
case's `observation` ("ends in the error page because the test session id is
fake — expected, not the assertion") so the viewer is told before they see it.

---

## Case 14 — Verifying only the entry compose surface when a shared component also appears in deeper pages

**Wrong approach**: after changing a shared chat input component, publishing a
passing UI report from the home compose surface only, even though the same
component also renders after entering an agent/conversation page.

**Why it's wrong**: shared components can be composed with different wrappers,
slots, and responsive containers across surfaces. A fix that looks correct on the
home input can still be misplaced on an inner conversation page.

**What it breaks**: the verify report goes green while a deeper product path
still shows the old or awkward warning placement, and the user has to point out
that the page after entry was never checked.

**Correct approach**: enumerate all product surfaces where the changed shared UI
renders before publishing. For ChatInput placement changes, verify both the home
input and an inner agent/conversation page, attach separate screenshot evidence
for each, and mark any skipped surface explicitly blocked or untested.

---

## Case 15 — Verifying action-bar placement without covering collapsed toolbar state

**Wrong approach**: after moving a warning into a chat input action bar, checking
only the normal expanded toolbar state and publishing the layout as passed,
without forcing the toolbar into its persisted collapsed / auto-collapsed state.

**Why it's wrong**: action bars often have their own overflow behavior and saved
user preference. Adding a warning beside the toolbar can shrink the measured
available width enough to trigger a popup collapse, or a previously saved
collapsed preference can hide the exact action the change is supposed to sit
beside.

**What it breaks**: the screenshot can look acceptable for a fresh profile while
real users who have collapsed the toolbar, or narrower input containers, see the
primary left action replaced by a chevron/popup icon.

**Correct approach**: for any UI change inside an action/toolbar row, verify both
the default state and the collapsed/overflow state. If the design requires a
specific action to stay visible, disable or bypass the toolbar collapse logic for
that surface and include evidence that no collapse chevron is rendered.
