# Trace Schema

The **T** of SCLPT. Without structured evidence, there is no pattern recognition
— just a feeling that the session went well.

A design session leaves three artifacts. Two are for humans. **The third is for
the system**, and it is the one that gets skipped.

| Artifact              | Audience      | Purpose                                               |
| --------------------- | ------------- | ----------------------------------------------------- |
| Design spec           | reviewers     | What we decided and why                               |
| Prototype             | reviewers     | What it feels like                                    |
| **Reality-check log** | **the skill** | **What the code overturned — feeds the Pattern Base** |

## The reality-check log

One row per assumption that met the code. It lives as a section **inside the
spec** (not a separate file — a separate file goes unread).

The schema:

| Field          | Meaning                                                         |
| -------------- | --------------------------------------------------------------- |
| **Assumption** | What was believed, in the words it was believed in              |
| **Code fact**  | What is actually true, with `file:line`                         |
| **Layer**      | L0 / L1 / L2 / L3 (see [layer-model.md](layer-model.md))        |
| **Verdict**    | `overturned` \| `confirmed` \| `refined`                        |
| **Pattern**    | `P-nn` if an existing pattern predicted it; `NEW` if it did not |

`NEW` is the whole point. Every `NEW` row is a hole in the Pattern Base, and
Step 6 of the workflow closes it.

### Worked rows — from the session that produced this skill

| Assumption                                  | Code fact                                                                                                   | Layer | Verdict    | Pattern      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----- | ---------- | ------------ |
| The home surface only ever has error briefs | `briefs.type` has four values, all produced in prod (`packages/types/src/brief/index.ts:37`)                | L1    | overturned | NEW → `P-04` |
| Task `paused` means "suspended"             | It means **pending review**; shares the `waitingForHuman` glyph (`src/components/ExecutionStatus.ts:50-52`) | L2    | overturned | NEW → `P-01` |
| Tool approval is two buttons                | It is a numbered radio list; the digits are the shortcuts (`.../Intervention/ApprovalActions.tsx`)          | L2    | overturned | NEW → `P-02` |
| The spinner is a CSS keyframe               | It is an SVG `<animateTransform>` (`src/components/RingLoading.tsx`)                                        | L2    | overturned | NEW → `P-03` |
| "Accept task" is a real action              | Assignment already wrote `assigneeUserId`; no pending state exists                                          | L1    | overturned | NEW → `P-05` |
| Deleting the section shell is safe          | It mounted `Recommendations` + two modals in three branches                                                 | L1    | overturned | NEW → `P-08` |
| A `projects` table exists                   | It does not; `GroupKey.Project` renders a knowledge base                                                    | L1    | overturned | NEW → `P-07` |
| Conversations can be shown to the team      | `topics` has no `visibility` column — privacy red line                                                      | L1    | overturned | NEW → `P-06` |
| The unread list needs a new endpoint        | `topicService.queryTopics({ statuses })` already returns it                                                 | L1    | overturned | NEW → `P-12` |

Nine assumptions, nine overturned, all `NEW` — which is exactly what a **cold
start** looks like. A healthy mature run should be mostly `confirmed` with one
or two `NEW`.

## Reading the log

The shape of the log _is_ the diagnosis of the session:

| Shape                                | What it means                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Many `overturned`, all `NEW`         | Cold start. The Pattern Base was blind here — harvest it.                                                         |
| Many `overturned`, all citing `P-nn` | **The patterns were not read.** Process failure, not a knowledge failure. Fix Step 0, not the design.             |
| Mostly `confirmed`, one or two `NEW` | Healthy. The system is working.                                                                                   |
| Zero rows                            | Either a trivial surface, or — far more likely — **nobody grounded anything.** Treat with suspicion.              |
| Zero `NEW` across a whole round      | **Saturation.** L1/L2 are mined out for this surface (see [layer-model.md](layer-model.md#saturation-per-layer)). |

That second row is worth dwelling on. If the code keeps overturning things the
Pattern Base _already knew_, the skill is fine and the run was sloppy. The fix is
to actually read Step 0 — not to add more patterns.

## Marking debt on the prototype itself

Anything the design shows that the data cannot supply gets a visible `NEW` tag
**on the mock**, not just in the spec. A reviewer looking at a picture must be
able to see which parts are real.

```
累计已执行 11h 06m  [NEW]     ← no column for this; would need a new query
```

This is the cheapest possible defense against `P-05`-class fake affordances: if
you cannot name the column, you must draw the tag.

## Why the log, and not just a good memory

The Pattern Base is the skill's long-term memory; the reality-check log is its
short-term one. Skipping the log does not merely lose a document — it breaks the
**C** (Closed Loop) of SCLPT, and the next session re-learns the same nine
lessons from scratch.
