# Worked Example — the home inbox

One complete trace, end to end. This is the session that seeded the Pattern Base,
so every mistake in it is real.

**Ask (L0)**: _"Look at our home surface. It hasn't had any design thought put
into it. What should actually be here?"_

Note what the ask is **not**: it is not a bug, not a spec, not a list of
requirements. It is a feeling. Everything below is the work of turning that into
something buildable.

---

## Step 1 — Ground

Two read-only subagents, in parallel: _how is this surface assembled?_ and _what
can the underlying tables actually produce?_

The second one is where the redesign was won. The surface rendered a single
brief type — errors — so it read as an error log. But `briefs` turned out to be
**a complete agent → human decision inbox** that nobody was using:

- four `type` values (`decision` / `result` / `insight` / `error`), **all
  produced in production** — an agent pausing a task for approval writes
  `decision`; task completion writes `result`; a watchdog writes `error`
- `priority`, interactive `actions` (Confirm / Request changes / Retry), linked
  `artifacts`, and a full read → resolve lifecycle

**The most valuable finding of the whole session was that three quarters of an
existing feature were switched off.** No amount of staring at the screenshot
would have produced it (`P-04`).

## Step 2 — Diagnose (structural, not aesthetic)

Three structural errors, each independent of taste:

1. **A decision inbox is being used as an error log.** (Above.)
2. **The surface is trying to be both a triage desk and a reading room.** Each
   card carried a paragraph-length summary — _too short to replace the document,
   too long to scan_. Users neither read it nor skipped it cleanly. (`P-09`, `P-10`)
3. **Signals were grouped by producer, not by required action.** What the user
   needs is "what is blocked on me", not "what did the agent say". (`P-11`)

## Step 3 — Align

Decisions surfaced one at a time, each with a recommendation. The two that
changed the shape of the answer:

- _Is the primary axis attention (what needs me) or progress (what's moving)?_
  → **attention.** Progress is context; attention is the reason to open the page.
- _Is the attention source agents, humans, or both?_ → **both, one inbox.**
  An agent saying "I'm stuck" and a colleague saying "@you" are the same signal
  to the person receiving them (`P-11`).

The human overruled the agent's first framing here — it had proposed organizing
around tasks, and the reply was, roughly: _"it should be organized around the
work, and around attention and goals — not around one entity type."_ That
correction is `P-11`.

## Step 4 — Prototype

Six iterations in the real design system. Every round, the code overturned
something:

| Round | The prototype claimed          | The code said                                                           |
| ----- | ------------------------------ | ----------------------------------------------------------------------- |
| v3    | invented status groups & icons | `ExecutionStatus.ts` is canonical; `paused` = _pending review_ (`P-01`) |
| v4    | tool approval = two buttons    | it is a numbered radio list; digits are the shortcuts (`P-02`)          |
| v4    | CSS keyframe spinner           | `RingLoading.tsx` — SVG `<animateTransform>` (`P-03`)                   |
| v5    | "Accept task" button           | assignment already wrote `assigneeUserId`; no such transition (`P-05`)  |
| v6    | `#seq · 4m 12s` on every run   | no duration column anywhere — computed client-side (`P-13`)             |

Five of the six Pattern Base Class-A/B entries came from these five rows. **The
prototype's job is not to be right — it is to be wrong in ways the code can
correct.**

## Step 5 — Scope: three buckets

| Bucket                     | Capability                                                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ **Now**                 | All four brief types (already stored). Running + unread topics — **one existing endpoint**, `queryTopics({ statuses })`. Status icons — import `ExecutionStatus.ts`. Resolve / feedback actions — reuse `BriefCardActions`. |
| ⚠️ **Blocked by a select** | The task's `T-42` ref and name: `listUnresolvedEnriched` **already joins `tasks`** but selects only `status`. Two more columns.                                                                                             |
| ❌ **New model**           | Mentions. Annotations. Presence. A `projects` entity. Per-run duration.                                                                                                                                                     |

**Shipped: everything in ✅ plus the two-column select.** Zero new tables, zero
migrations. The ❌ bucket went into the spec by name, with its cost (`P-13`).

The redesign that had started as a sweeping team-collaboration vision shipped as
a focused personal inbox — **not as a retreat, but because that was the part that
was real today** (`P-12`).

## The trap that nearly shipped

Deleting the old section shell would have silently removed `Recommendations`,
`DocumentPreviewModal` and `TopicChatDrawer` — all mounted _inside_ it, across
three render branches. No type error. No failing test. The artifact-preview and
"view run" buttons would have rendered and done nothing.

Caught by grepping the render tree before deleting (`P-08`), re-mounted in the
new composition, and each one given **its own end-to-end verification case** —
because this class of regression is invisible to the compiler and to unit tests.

## Step 6 — Close the loop

Nine assumptions overturned, nine `NEW` → patterns `P-01` … `P-08`, `P-12`.
That is the cold-start signature (see
[trace-schema.md](trace-schema.md#reading-the-log)).

**Saturation, honestly assessed**: L1/L2 for this surface are close to mined out
— a second grounding pass over `briefs` / `topics` / `tasks` would likely turn up
little. L0 is wide open: the team-collaboration half of the original ask was
never answered, only deferred.

## What generalizes

1. **The biggest win was a switched-off feature, not a new one.** Look for those
   first — a table whose enum the UI ignores is free product.
2. **Every prototype round should be falsified by code.** A round that only
   moves pixels means grounding was skipped.
3. **The shippable subset is a discipline, not a compromise.** "What needs zero
   new tables?" is the question that converts a vision into a merged PR.
