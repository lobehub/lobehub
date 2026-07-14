# Pattern Base

> **Mandatory**: read this file in full before every product-design run, and
> self-check against each pattern.
>
> **Append after every run.** When the code overturns an assumption that no
> pattern here predicted, that is a new gap — write it down. Each entry:
> **Symptom / The real case / Why it happens / How to detect it next time.**
>
> Every claim must cite `file:line`. A pattern without a citation is a rumor,
> and it will send the next reader to fix the wrong thing.
>
> This is the **P** of SCLPT. Its coverage is the ceiling of what this skill can
> catch. Saturation = a grounding round that produces **zero** new entries here.

---

## Class A — You are about to reinvent something that exists

The single most expensive failure mode. Every entry below was really produced by
an agent designing from imagination and getting caught by the code later.

### P-01 — Inventing a status system when a canonical one exists

**Symptom**: you write out your own status list ("waiting / done / error") with
your own icons and colors.

**The real case**: an agent designed a home inbox around invented groups —
"等我拍板 / 等我验收 / 出错待修". The repo already had
`src/components/ExecutionStatus.ts`, the single source of truth for status →
icon + color, shared by tasks and topics. Worse, its semantics contradicted the
invention: **`TaskStatus.paused` is not "suspended" — it is _pending review_**
(`ExecutionStatus.ts:50-52` maps it to the `waitingForHuman` hand glyph; the
kanban column is literally named `needsInput`). A design built on "paused =
suspended" would have shipped a wrong mental model.

**Why it happens**: status enums live in `packages/types` and `packages/database`,
far from the surface being designed. They are invisible from the screenshot.

**Detect**: before naming any state, `grep -r "STATUS_VISUALS\|StatusIcon\|_STATUSES"`.
If a canonical map exists, **import it** — never re-derive it.

### P-02 — Inventing an interaction that is already implemented

**Symptom**: you sketch a plausible-looking approval dialog / comment box /
confirmation flow.

**The real case**: an agent drew a tool-approval card with two buttons
(Approve / Reject). The real `ApprovalActions` is **a numbered radio list** —
`1. Approve` / `2. Approve, and don't ask again` / `3. [inline reject-reason
input]` + a Submit button with an inline `↵` icon; **the row numbers are the
keyboard shortcuts**. The invented version was not a simplification, it was a
different product. The user's verdict: "感觉好丑啊" — and they were right, it
was a fantasy.

Same session, same mistake twice: "打回 / 要求修改" was designed as a new comment
box, when `BriefCardActions` already **replaces the action row in place** with an
editor, and submitting runs `submitFeedback` — which resolves the brief **and
re-runs the agent** with the comment. The real semantics were far richer than
"leave a comment".

**Why it happens**: interaction implementations live under `features/`, several
directories from where you are designing, and their names do not advertise them.

**Detect**: for every interaction verb in your design (approve, comment, retry,
share, preview), grep for it under `src/features/` **before** drawing anything.
Assume it exists.

### P-03 — Inventing a loading / motion primitive

**Symptom**: a CSS `@keyframes spin` in your prototype.

**The real case**: `src/components/RingLoading.tsx` is the canonical spinner —
and it is **not** CSS: it is an SVG `<animateTransform>` (viewBox 1024, track
`r=400 / strokeWidth=128`, a 90° arc, `dur=1s`, linear). There is a _second_,
deliberately different one — `TopicStatusIcon`'s inline `RunningIcon` — which
adds a filled center dot so a running row stays in the same `CircleDot` visual
family as the static statuses. Picking the wrong one is a real (if quiet) bug.

**Detect**: grep `RingLoading|NeuralNetworkLoading|animateTransform` before
animating anything. Ask _which_ surface it belongs to — list row vs. activity
feed have different answers.

---

## Class B — The data is not what the UI implies

### P-04 — A table is being used as a subset of itself

**Symptom**: the surface renders one enum value and you assume that is all the
table produces.

**The real case**: the home surface rendered only `brief.type === 'error'`, so
it read as an error log. The `briefs` table actually has **four** types —
`decision` / `result` / `insight` / `error` (`packages/types/src/brief/index.ts:37`)
— plus `priority`, interactive `actions`, `artifacts`, and a full
read/resolve lifecycle. All four are produced in production
(`requestCheckpoint` → `decision`, taskLifecycle → `result`, watchdog →
`error`, …). **A decision inbox was being used as a report box.** The single
highest-leverage change in that entire redesign was: render the other three.

**Why it happens**: the UI is the only thing you can see. The unused half of the
schema is invisible until you read it.

**Detect**: for every table the surface touches, enumerate **every** enum value
and **every** column, then ask "which of these does the UI ignore, and why?"
The answer is often "for no reason".

### P-05 — A button that offers a transition the data model does not have

**Symptom**: an action that feels natural but cannot possibly change anything.

**The real case**: a design put an "Accept task" button on a task someone
assigned to you. But assignment writes `tasks.assigneeUserId` **immediately** —
the task is already yours. There is no `pending_assignment` state, so the button
would have been a no-op that lies to the user. The honest action is
**Start** (`backlog → running`) or **Reassign**.

**Why it happens**: the affordance is copied from other products (Jira-style
accept/decline) without checking whether this data model has the intermediate
state those products have.

**Detect**: for every button, name the exact state transition it performs — the
column, the old value, the new value. If you cannot, it is a fake action. Either
delete it, or you are proposing a schema change (say so out loud).

### P-06 — A missing column is a product constraint, not a detail

**Symptom**: a design that shows content the ownership predicate cannot filter.

**The real case**: `tasks` / `documents` / `agents` all have a `visibility`
column; **`topics` / `messages` / `sessions` do not.** The shared ownership
helper therefore cannot scope conversation content per-member — which makes
"show what the team is working on" a _privacy incident_ the moment it includes
conversations. The design had to be explicitly constrained to entities that
carry `visibility`. This was a hard boundary, not a preference.

Related: `topics.status = 'unread'` is a **single global column**, not per-user.
"Unread" as a per-member concept does not exist without a new join table.

**Detect**: for every entity you want to display, check that its table has the
column the access rule needs. Absence of a column is a **red line**, and it
belongs in the spec in bold.

---

## Class C — Naming lies

### P-07 — The identifier does not mean what it says

**Symptom**: you build a mental model out of a symbol name.

**The real cases**, all in one codebase:

- The sidebar's `GroupKey.Project` renders a section titled **"Library"**, and
  its create action navigates to `/knowledge/bases/:id`. There is **no
  `projects` table**. "Project" was an empty concept.
- The chat input's `@` mention has a category literally called `member` — which
  resolves to **agents**, not people. Selecting one triggers `callAgent`. A
  design that read "member" as "colleague" would have specified a feature that
  does not exist.
- Topic sidebar's `ByProjectMode` groups by **status**, not by project.

**Detect**: never take a name as evidence. Open the file and read what it
renders / navigates to / calls. Cite `file:line`, not the symbol name.

---

## Class D — Composition traps

### P-08 — Deleting a section shell silently takes its mounted globals with it

**Symptom**: a clean refactor that removes a container component, and two
unrelated features quietly stop working.

**The real case**: `DailyBrief/index.tsx` was the section shell for the home
brief — and it also mounted `<Recommendations />` (in **three** render branches),
`<DocumentPreviewModal />` and `<TopicChatDrawer />`. Deleting the shell would
have taken artifact preview and "view run" down with it, with **no type error
and no test failure** — the buttons would render and do nothing.

**Detect**: before deleting or replacing a container, grep its render tree for
modals, drawers, portals, and providers. Anything global that it mounts must be
re-mounted somewhere, and **each one needs its own verification case** — this
class of regression is invisible to the compiler.

---

## Class E — Judgment rules (earned, not invented)

These are the design principles that survived contact with the code. They are
patterns because each one was arrived at by _rejecting_ a plausible alternative.

### P-09 — A dashboard is not a home page; a triage desk is

**Rule**: an inbox-like surface answers exactly one question — **"is this mine to
handle?"** Reading and analysis happen after the click, elsewhere.

**Why**: the rejected alternative was a team dashboard (usage trends, member
leaderboards, spend charts). Its predictable fate: the owner looks for two
weeks, the members never look. A "what happened" surface has no pull; a "what is
blocked on me" surface does.

**Test**: for every element, ask _if the user never clicks this, does anything
get stuck?_ If no, it does not belong on the surface.

### P-10 — Density follows decision cost

**Rule**: an item's size on screen should match how much thinking it demands —
not how much text the producer wrote.

| Signal                 | Form                                                          |
| ---------------------- | ------------------------------------------------------------- |
| Needs my decision      | Expanded: title + **one-sentence** reason + action buttons    |
| Just needs to be known | One line: title + source + time. Summary appears **on click** |
| Needs nothing from me  | Collapse into a **count**. Only anomalies get their own row   |

**Why**: the rejected alternative was "compress every card". That trades
readability for density and loses both. The real failure of the original surface
was a paragraph-length summary that was _too short to replace the document and
too long to scan_ — the worst of both.

### P-11 — Group by the action required, not by the source entity

**Rule**: an agent saying "I'm stuck, decide this" and a colleague saying
"@you, look at this" are **the same signal**. They belong in the same list,
grouped by what the user must do — not split into "agent stuff" and "people
stuff".

**Why**: entity-shaped grouping is how the _system_ sees the world. Action-shaped
grouping is how the _user_ does. Only one of them is the user's problem.

**Corollary**: sort within a group by what is actually blocking. A stuck
decision blocks an agent _right now_; a failed run has already stopped and can
wait — so failures sink to the bottom, even when their priority field says
`urgent`.

---

## Class F — Scope discipline

### P-12 — The three-bucket audit decides scope, not taste

**Rule**: before scoping, sort every capability the design needs into
**available now** / **blocked by a predicate or select** / **needs a new model**.
Then ship the zero-new-table subset first.

**The real case**: a full team-collaboration design needed mentions,
annotations, presence, and a new project entity — all bucket ❌. But the
_attention inbox_ at its core needed **zero new tables**: the four brief types
were already stored, running/unread topics were already queryable through one
existing endpoint, and the only backend change was adding two columns to a
`select` on a join that already existed. That subset shipped while the expensive
half was still being debated.

**Detect**: if your plan's first milestone contains a migration, you probably
have not looked hard enough for the shippable subset.

### P-13 — Name what you are _not_ building, and why

**Rule**: capabilities dropped for lack of data go into the spec explicitly, with
the reason. Silence reads as an oversight and gets re-litigated in review.

**The real case**: the prototype showed a run's `#seq · 4m 12s`. Neither exists:
`task_topics` has no `completedAt`, `topics` has no `startedAt`/`duration`, and
`agent_operations` — which does have `processingTimeMs` — is **not exposed over
tRPC at all**. Duration is computed client-side at read time, per row. Writing
this down turned "you forgot the timestamps" into "we know, here is the cost".
