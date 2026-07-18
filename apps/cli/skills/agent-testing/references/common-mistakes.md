# Common Mistakes (generic layer)

> **This is the GENERIC layer of the living log.** It is read-only in a consumer
> repo and updated only by PR to the CLI repo that ships this skill. Every entry
> here must be **product-independent** — no project's packages, routes, schemas,
> env vars, service names, or business logic. Project-specific learnings go to
> `.agents/verify/common-mistakes.md` (the writable project layer).
>
> **Mandatory:** read this file in full before every agent-testing run and
> self-check against each case. When the user gives negative feedback that is
> product-independent, genericize it and PR it here; otherwise record it in the
> project layer. Each case: Wrong approach / Why it's wrong / What it breaks /
> Correct approach.

---

## M1 — Judging `passed` from heuristics instead of looking at the screenshot

**Wrong approach**: after navigating to a surface, deciding "renders fine / passed"
from only `innerText` keyword greps + a skeleton/element count, without ever opening
the screenshot.

**Why it's wrong**: the persistent nav / layout-shell text is always in the DOM, so
an `innerText` grep almost always false-positives. A blank/white page also has 0
skeletons, so `skeletons === 0` cannot tell "rendered successfully" from "rendered
blank".

**What it breaks**: publishes a **false `passed`** — a blank or watermark-only page
reported as working, hiding a real regression.

**Correct approach**: every screenshot destined for a report `evidence` **must first
be opened with the Read tool and visually confirmed to render the expected content**
before pass/fail. Greps/counts are supporting signals only, never the verdict. A
blank page / watermark / layout-shell-only = fail or uncertain — go find the root
cause.

---

## M2 — Goal is verifying error states, but stopping at happy-path because injection is hard

**Wrong approach**: after the first batch of fault-injection methods fails to force
an error, giving up on the error-state screenshots and shipping only happy-path +
unit tests, marking the core goal uncertain/blocked.

**Why it's wrong**: the **entire point** of the task was verifying the error states.
Abandoning that = task not done — especially when other viable methods exist
unattempted.

**What it breaks**: the deliverable doesn't cover what the user asked for — a wasted
round that needs redoing.

**Correct approach**: **do not stop until the core goal is met.** When the first
batch of methods fails, immediately switch to the next known-working one — see
[probe-mock-patterns.md](./probe-mock-patterns.md) for the escalation ladder (code
injection via HMR, CDP `Network.setBlockedURLs`, server-side fault injection). Get
the **real failure-state evidence** before writing the report.

---

## M3 — Deriving the task from commit messages / branch name instead of the actual ask

**Wrong approach**: on a resumed session with lost prior context, reading the branch
name and top commits and concluding _that_ is the thing to verify — then building a
whole test run around it — when the user's real task was a different feature.

**Why it's wrong**: a branch's committed work is not necessarily the current ask.
When context was summarized/lost, the commit history is a _hypothesis_, not the task.
The task lives in the user's words.

**What it breaks**: burns a full test run and clarifying rounds on the wrong feature
before course-correcting.

**Correct approach**: when the user references a task you don't have in context, say
so plainly and RECOVER it before acting — check `.records/reports/` for prior
sessions on this branch, read the live conversation's own messages (the first user
turn is usually the task), or ask for a pointer. Only translate the ask into
code/commits after it's grounded.

---

## M4 — Asserting a capture/tooling root cause from plausibility instead of measuring it

**Wrong approach**: when a screenshot came out black or a capture failed, declaring a
root cause from what "sounds right" (missing permission, display sleep, tool bug) and
publishing it — before running the experiment.

**Why it's wrong**: each of these is falsifiable in seconds and often wrong. A black
frame can be display sleep OR a wedged capture daemon OR a real blank page; guessing
sends the next reader to fix the wrong thing.

**What it breaks**: a published report with a wrong root cause, plus wasted
round-trips retracting each claim.

**Correct approach**: for any capture / permission / timing / "environment" failure,
**reproduce and measure before asserting or publishing** — pixel brightness for
blackness, the permission bit for TCC, an A/B with the variable toggled to isolate
the cause. State "confirmed by X" vs "suspected", and never ship a root cause a
one-line probe could have checked.

---

## M5 — Attaching a stale "before" screenshot as a passed case's evidence (unlabeled)

**Wrong approach**: putting BOTH the "after" and a stale "before" screenshot into the
same `cases[].evidence` array, unlabeled. The verify page renders every evidence
image with its filename as a heading, so the user opens the stale shots and concludes
the fix didn't land.

**Why it's wrong**: a passed case's evidence must show the PASSING (after) state. An
unlabeled before-shot next to it reads as "the current result", making a correct fix
look broken. Filenames are not captions.

**What it breaks**: the user reads a green report as a failure, loses trust, and it
takes another round to re-explain.

**Correct approach**: never ship a raw stale/before screenshot as standalone
evidence. When a contrast helps, use the report format's **native comparison
pairing** — attach both raw screenshots tagged with a shared `comparison` id and the
page renders them under Before / After bands (see
[report.md](./report.md)). **Do NOT hand-compose the two shots into one image** — the
page owns the labeling. Two more traps: one evidence item per case (don't reuse the
same pair across cases), and a group needs **exactly one `before` and one `after`**
or it silently degrades to unlabeled evidence.

---

## M6 — Verifying against a stale build, not your working-tree code

**Wrong approach**: driving an already-running app instance to verify a working-tree
change, and eyeballing the first screenshot as "looks changed".

**Why it's wrong**: a resident or packaged app serves a BUILT snapshot — it does not
reflect uncommitted / HMR src changes. The change under test may not be running at
all, so the screenshot proves nothing about your code.

**What it breaks**: verifying against code that isn't your change → a false pass (or
false fail) on the wrong bundle entirely.

**Correct approach**: verify working-tree code in an instance that actually loads it
(a dev instance with HMR/live reload), and **prove it's live by MEASURING a
known-changed value** (a computed style, a new string) before trusting any
screenshot. Don't disturb the user's resident instance — use a separate
instance/port. Remember main-process / server / adapter code often does not
hot-reload; restart the process and prove which code it runs before concluding a
logic bug.

---

## M7 — Embedding a local-path screenshot in the chat reply

**Wrong approach**: ending the final reply with an inline image embed or link
pointing at the local report dir, believing it will render as a picture in chat.

**Why it's wrong**: the chat UI cannot load a local filesystem path. An image embed
of a local path renders as an empty broken-image box, and a markdown link to a local
path is an un-openable dead link. Local report paths only resolve on the machine,
never inside the message.

**What it breaks**: the reply looks like it has evidence but shows nothing — the user
gets a broken box and has to go find the verify link anyway.

**Correct approach**: put NO images and NO local-file links in the chat reply. The
published `/verify/<id>` page already renders every screenshot inline — that URL is
the only visual deliverable. Describe key visual outcomes in prose; mention the local
report dir as a plain string (not a markdown link) if a reference is useful.

---

## M8 — Asking the user "how should I run this?" instead of defaulting to a full isolated run

**Wrong approach**: when a visual/screenshot request needs a non-trivial environment
(the app must run a specific branch, a fixture must be built, an isolated instance is
needed), stopping to ask the user which approach to take — full isolated run vs a
lighter shot vs a static prototype.

**Why it's wrong**: environment mechanics are the skill's job to own. Presenting env
difficulty as a menu of shortcuts pushes setup decisions back onto the user and
signals the agent will cut corners on fidelity when the env is inconvenient.

**What it breaks**: wastes a round on a question the user doesn't want.

**Correct approach**: for any "run it and show me" request, default to the **full
isolated run** that ends in a published verify report — spin up whatever dedicated
instance and fixture data the surface needs (a throwaway repo, an isolated dev
instance, seeded data), capture the real rendered evidence, verify it by opening the
image, and publish. Only surface a plan-approval question when the _product decision_
is ambiguous (what to test), never for _environment mechanics_ (how to render it).

---

## M9 — Handing the user the sign-in click when the app under test is signed out

**Wrong approach**: an isolated instance came up signed out, so the run stopped and
offered the user a choice: "I click Sign in and you authorize" vs "skip the
screenshot".

**Why it's wrong**: auth is environment mechanics, and the skill owns those end to
end. "Log in once in the app" is addressed to the **agent**, not the user.

**What it breaks**: burns a round on a question the user doesn't want, and stalls a
UI-touching change one click short of its screenshot.

**Correct approach**: drive the sign-in yourself — click the app's own "Sign in"
entry, follow the OAuth flow in the browser it opens, and get back into the app. Only
escalate when a step genuinely needs something you cannot supply (a 2FA push on their
phone), and then name the exact blocking step instead of offering to drop the
evidence. Corollary: never assume a profile is signed in because it exists — probe
for a real signed-in state (a cheap authed call) before building a fixture on top of
it; a rendered shell is not proof (a signed-out onboarding screen has text too).

---

## M10 — Self-judging a screenshot as "too costly" and asking the user to picture the result

**Wrong approach**: after a small user-facing UI change, skipping the rendered
screenshot with "it's a trivial style change; restarting to screenshot costs more
than it's worth — tell me if you want one." Deciding the cost/benefit for the user and
shipping a diff they had to picture.

**Why it's wrong**: whether a verification artifact is "worth it" is not the agent's
to decide. The measuring stick is _whether the user can conveniently inspect the
product_, not how much effort the agent spends rendering it. Making the user guess the
visual effect from a diff is the actually-expensive outcome.

**What it breaks**: the user can't check the deliverable, loses trust, and has to push
back — burning a round to get the screenshot that should have been produced up front.

**Correct approach**: for ANY user-facing change (even one line of padding/color),
default to rendering it and attaching the screenshot as a record point — open the
image to confirm, publish. Never offer the screenshot as an opt-in.

---

## M11 — Reporting a UI-touching change with only CLI transcripts and no screenshot

**Wrong approach**: when a change includes visible UI (copy, badges, alerts, a
rejection state), treating the run as purely backend/service validation and
publishing only command-output evidence.

**Why it's wrong**: CLI transcripts prove code paths and tests passed, but they do not
let the reviewer inspect the rendered UI. "The diff touches no UI file" does not mean
"no UI surface" — a permission tightening, for instance, IS a UI-visible state (the
blocked user still sees the affordance and now gets a rejection).

**What it breaks**: the user opens the report expecting visual proof and finds none.

**Correct approach**: if any UI surface changed, include a visual case in the same
run. Drive the real UI and attach a screenshot of the changed/blocked state (and the
success state where relevant), or explicitly mark the UI screenshot case blocked with
the measured environment blocker. Do not present a UI-touching report as complete with
only CLI evidence.

---

## M12 — Verifying the UI state but not the final effect / payload

**Wrong approach**: marking a "inject context / apply setting / send data" feature
verified because the UI showed the expected chip/badge/state — without checking the
actual payload or side effect the feature is supposed to produce.

**Why it's wrong**: UI metadata can be saved and displayed while a later
runtime/transport gate drops it before the real effect. The UI looks successful while
the underlying behavior never happened.

**What it breaks**: ships a feature that looks right in the UI but has no effect;
the user must inspect the network/DB to discover it.

**Correct approach**: for any feature that claims to change what the system _does_,
verify the last mile — assert against the transformed request/payload or the observed
side effect (a network body, a DB row, a downstream call), and treat the UI state as
supporting evidence only.

---

## M13 — GIF evidence ending on an expected-failure frame reads as "the page failed"

**Wrong approach**: for a loading/streaming case, attaching a GIF that records the
full timeline through to a terminal error state that the test data inevitably
produces. The GIF loops and rests on its final frames, so the viewer opens the report
and sees the error, not the asserted state.

**Why it's wrong**: the LAST frame of a GIF is its de-facto headline. An
expected-failure terminal state without explanation reads as the case failing, even
when the asserted behavior passed.

**What it breaks**: the user reads a passed case as a failure and a round is burned
re-explaining.

**Correct approach**: trim evidence to the asserted state — end the GIF on the phase
you're asserting (cut frames after the terminal state), or attach a static shot of the
asserted state as primary evidence. If the terminal state is worth showing, say so in
the case's `observation` so the viewer is told before they see it.

---

## M14 — Verifying only the entry surface when a shared component also renders deeper

**Wrong approach**: after changing a shared UI component, publishing a passing report
from one surface only, even though the same component also renders on other pages.

**Why it's wrong**: shared components are composed with different wrappers, slots, and
responsive containers across surfaces. A fix that looks correct in one place can still
be misplaced elsewhere.

**What it breaks**: the report goes green while a deeper product path still shows the
old or awkward behavior, and the user has to point out the surface that was never
checked.

**Correct approach**: enumerate every product surface where the changed shared UI
renders before publishing, attach separate screenshot evidence for each, and mark any
skipped surface explicitly blocked or untested.

---

## M15 — Verifying a UI change only in its default state, not its collapsed/overflow state

**Wrong approach**: after changing something inside an action bar / toolbar / list
row, checking only the normal expanded state and publishing, without forcing the
collapsed / auto-collapsed / overflow state.

**Why it's wrong**: bars and rows often have their own overflow behavior and saved
user preference. A change can shrink the available width enough to trigger a collapse,
or a previously saved collapsed preference can hide the exact affordance the change
sits beside.

**What it breaks**: the screenshot looks fine for a fresh profile while real users
with a collapsed toolbar or narrower container see something different.

**Correct approach**: for any UI change inside a bar/row with overflow behavior,
verify both the default and the collapsed/overflow state, with evidence for each.

---

## M16 — Publishing a component harness when the user asked for full product verification

**Wrong approach**: when the product surface hit friction once, declaring it blocked
and publishing a narrow component harness as the main answer — even though another
live path (a running dev instance, a sibling worktree) was available.

**Why it's wrong**: a component harness proves a narrow render contract; it does not
prove the full product composition, layout, theming, or that the evidence is
inspectable in the real surface. Environment friction is the skill's job to solve, not
a reason to downgrade before exhausting known-working paths.

**What it breaks**: the user opens a report expecting full product evidence and gets a
partial proof.

**Correct approach**: before marking a product surface blocked, inventory existing dev
instances and running surfaces, measure the target to confirm it renders current code,
and use that path if it does. Keep a harness only as supporting evidence; the primary
UI evidence must come from the product surface, or the report must clearly fail/block
after every known path is measured.

---

## M17 — Turning a feature verification into an unbounded environment repair

**Wrong approach**: after the normal surface fails to boot, repeatedly modifying
shared dev configuration, reinstalling the whole workspace, and chasing unrelated
dependency problems before running any assertion for the feature under test.

**Why it's wrong**: environment readiness is a gate, not the test goal. A workaround
that changes shared configuration can also make the verification less representative,
while an open-ended repair loop produces no feature evidence.

**What it breaks**: the user waits through a long sequence of setup experiments, the
tree gains unrelated edits, and the run still has no reportable result.

**Correct approach**: follow only recovery paths documented by this skill or the
project adapter. If the failure mode is not covered, stop, revert any experimental
changes, summarize the exact checks and evidence collected, and ask the user before
continuing. Do not repair the environment, switch surfaces, or invent a fallback
without direction.

---

## M18 — Probing the wrong layer: asserting a fixture landed because the write succeeded

**Wrong approach**: writing a fixture directly to the database, reloading the page, and
reading what the UI shows — then treating a stale value as a product bug.

**Why it's wrong**: a persisted client cache (SWR / IndexedDB / localStorage) can keep
serving the old value. A successful DB write proves the row changed; it proves nothing
about what the app is _running on_. A fixture bug wearing a product-bug costume is the
most expensive kind.

**What it breaks**: you nearly file your own fixture as a regression.

**Correct approach**: after any direct-DB fixture write, cold-load (clear client
storage/caches, re-seed auth, reopen) and then **assert the fixture in the store
before asserting anything downstream of it**. The DB is where you _wrote_ it; the store
is where the behavior _reads_ it — verify at the layer the behavior reads. See
[probe-mock-patterns.md](./probe-mock-patterns.md) B.

---

## M19 — Building an elaborate mock before checking whether the env already has the real thing

**Wrong approach**: needing a capability (a working provider key, a service) and,
finding none in the shell env, building a mock server and seeding it — then watching
the mock receive **zero** requests while the run produces real output.

**Why it's wrong**: the capability may already exist somewhere the runtime actually
reads (a different config store than the one you checked). Two unmeasured assumptions
stack: that no capability existed, and that you knew where it comes from.

**What it breaks**: a chunk of the run spent building an apparatus the test didn't
need, plus a fixture to tear down. Worse, had the mock _partially_ worked, the run
would have silently verified a fake path.

**Correct approach**: before constructing any mock, **probe the env for the real
capability** — query the config the runtime reads, or fire one cheap real call and see
whether it completes. Only mock what is provably absent. And when a mock records
nothing while the feature clearly works, that is the signal the mock is _not in the
path_ — everything "verified" through it is unverified.

---

## M20 — Bare invocation: narrating skill setup, then asking an open "what should I test?"

**Wrong approach**: invoked with no test target, the agent announces "I'm loading the
mandatory living logs first", reads both logs in full, then asks an open "what should I
verify?" that ignores the visible candidate (the current branch and its commits).

**Why it's wrong**: the living logs inform execution, not target selection — reading
them before a target exists burns context that may be compacted away before the run.
Narrating internal setup is compliance-reporting the user never asked for. And an open
question pushes work onto the user that observable context could have pre-filled.

**What it breaks**: two user-visible turns whose combined value is one clarifying
question, asked twice.

**Correct approach**: ground the target first (SKILL.md Step 0): the user's words > an
inferred candidate from branch/commits/working tree, confirmed via one structured
question and labeled as a guess (never executed on unconfirmed) > an open question only
as last resort. Read the living logs once the target is known, and never narrate
skill-internal setup.

---

## M21 — A status badge is not proof the error message rendered

**Wrong approach**: marking an error-state UI case passed because the page showed a
`Failed` badge, while the screenshot did not actually contain the error alert or its
translated message.

**Why it's wrong**: the badge proves only that a failed state reached the page. It does
not prove the error was translated and presented to the user, which is the core
assertion of an error-message verification.

**What it breaks**: a report claims users receive an actionable explanation while its
evidence shows none.

**Correct approach**: for an error-presentation case, visually require all the signals
in the same screenshot: the failed status AND the error alert containing the expected
user-facing message. An unrelated warning or setup reminder does not satisfy the
assertion.

---

## M22 — Coordinator hand-driving a broken flow instead of re-delegating

**Wrong approach**: after a delegated verification subagent dies mid-case, the
coordinator takes over and drives the remaining flow inline — dozens of small steps
plus a deep root-cause dig into a flapping shared dependency, all in the main loop.

**Why it's wrong**: the coordinator's per-step latency and context cost are far higher
than a subagent's, and inline grinding turns one recoverable failure into a long
visible stall. Root-causing an env flake is also not the test's goal.

**What it breaks**: the user watches minutes of micro-steps with no case progress;
total wall-clock and token spend balloon for zero extra evidence value.

**Correct approach**: when a delegated case dies, repackage the _remaining_ steps into
a fresh, tightly-scoped subagent prompt (include everything already learned: working
recipes, seeded fixtures, exact remaining assertions). Timebox any environment rabbit
hole to a couple of probes, then switch to a disposable local substitute instead of
diagnosing shared infrastructure.

---

## M23 — Stopping after a fix without publishing the next verification round

**Wrong approach**: implementing and locally validating a requested iteration, then
ending the task without committing, pushing, or publishing a fresh immutable verify run
to the existing acceptance.

**Why it's wrong**: an acceptance is the cross-round audit trail. A local-only fix
leaves the PR stale and makes the acceptance claim the previous round is still the
latest result. Local tests are preparation, not delivery.

**What it breaks**: reviewers can't inspect the updated code, the acceptance timeline
misses the iteration, and the user has to ask whether anything shipped.

**Correct approach**: after every requested iteration, complete the whole delivery loop
unless told not to: validate the new state, commit and push the branch, create a fresh
report directory, ingest exactly once as the next immutable run on the same subject
acceptance, verify the new round appears, then return both the commit and the
production link.

---

## M24 — Labeling sequential flow steps as a before/after comparison

**Wrong approach**: attaching two sequential steps of one flow as a `comparison`
pair with `before` and `after` roles.

**Why it is wrong**: comparison rendering means the same surface before and after
a change. Sequential steps are neither a defect nor its remediation.

**Correct approach**: reserve `comparison` for one view in two states. Attach
flow steps as ordinary ordered evidence with a caption naming each step.

---

## M25 — Publishing locally because the acceptance subject exists only locally

**Wrong approach**: ingesting the primary report into a local instance because
its task or topic is absent from production.

**Why it is wrong**: localhost links disappear with the environment and cannot
serve as shared deliverables. Subject convenience does not change the production
publication requirement.

**Correct approach**: create a production task or topic as the acceptance anchor,
then publish in a clean environment against `app.lobehub.com`. A local ingest may
supplement the run, but never replace the production deliverable.

---

## M26 — Creating an acceptance without its requirement

**Wrong approach**: using a bare subject string on the first ingest and assuming
the acceptance goal is inferred automatically.

**Why it is wrong**: the requirement is author-supplied. Omitting it leaves the
decision page without the business goal against which all rounds are judged.

**Correct approach**: supply `--requirement` or the object subject form on the
first ingest. State the cross-round business goal, not the current round's scope.
