# Trace Schema

The **T** of SCLPT. Without structured evidence, there is no pattern recognition
— just a feeling that the session went well.

A design session leaves three artifacts. Two are for humans. **The third is for
the system**, and it is the one that gets skipped.

| Artifact              | Audience      | Purpose                                                   |
| --------------------- | ------------- | --------------------------------------------------------- |
| Design spec           | reviewers     | What we decided and why                                   |
| Prototype             | reviewers     | What it feels like                                        |
| **Reality-check log** | **the skill** | **What the business overturned — feeds the Pattern Base** |

## The reality-check log

One row per assumption that met the business model. It lives as a section
**inside the spec** — a separate file goes unread.

| Field            | Meaning                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| **Assumption**   | What was believed, in the words it was believed in                                         |
| **What is true** | The business fact that overturned it, in **domain language**                               |
| **Model**        | Which of Cooper's three models this is a fact about (see [layer-model.md](layer-model.md)) |
| **Verdict**      | `overturned` \| `confirmed` \| `refined`                                                   |
| **Pattern**      | `P-nn` if an existing pattern predicted it; `NEW` if it did not                            |

Two rules keep this honest:

- **"What is true" is written in domain language, not implementation language.**
  Not _"the enum has four values"_ — \*_"the business models four kinds of
  agent-to-human message, and the surface renders one."_ If you cannot state the
  fact without naming a table, it is probably not a product finding at all (see
  [layer-model.md](layer-model.md#which-layer-is-a-given-finding-from)).
- **`NEW` is the whole point.** Every `NEW` row is a hole in the Pattern Base, and
  Step 6 closes it.

### Worked rows — from the session that seeded this skill

| Assumption                                      | What is true                                                                                                                                                                   | Layer          | Verdict    | Pattern      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------- | ------------ |
| The surface only ever has agent errors          | The business models four kinds of agent-to-human message — a decision to rule on, a deliverable to accept, an insight, an error. All four are produced daily; **one is shown** | implementation | overturned | NEW → `P-04` |
| `paused` means the user suspended it            | It means **a human is blocking the agent** — pending review. It is the most urgent state on the page, not a "later" bucket                                                     | implementation | overturned | NEW → `P-01` |
| "Request changes" leaves a comment              | It **re-tasks the agent**: resolves the item and re-runs it with the comment as input                                                                                          | implementation | overturned | NEW → `P-02` |
| "Accept task" is a real action                  | Assignment is immediate and unilateral. There is no "offered, pending acceptance" state — the button implies you could decline, and you cannot                                 | implementation | overturned | NEW → `P-05` |
| There is a project concept                      | There is not. The section named "Project" is a knowledge library                                                                                                               | implementation | overturned | NEW → `P-03` |
| We can show the team what's being discussed     | Conversations have **no notion of belonging to a member**. Showing them is a domain change, not a layout choice                                                                | implementation | overturned | NEW → `P-06` |
| A per-member unread badge is a UI decision      | "Unread" is a property of the conversation, not of a person                                                                                                                    | implementation | overturned | NEW → `P-06` |
| Surfacing the unmodeled work needs new plumbing | The business already models "running" and "unread" work; it was simply never asked for                                                                                         | implementation | overturned | NEW → `P-10` |
| Elapsed time per run can be shown               | The business does not model a run's duration at all                                                                                                                            | implementation | overturned | NEW → `P-11` |

Nine assumptions, nine overturned, all `NEW` — the **cold-start** signature. A
mature run should be mostly `confirmed`, with one or two `NEW`.

## Reading the log

The shape of the log **is** the diagnosis of the session:

| Shape                                | What it means                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Many `overturned`, all `NEW`         | Cold start. The Pattern Base was blind here — harvest it.                                               |
| Many `overturned`, all citing `P-nn` | **The patterns were not read.** A process failure, not a knowledge failure. Fix Step 0, not the design. |
| Mostly `confirmed`, one or two `NEW` | Healthy. The system is working.                                                                         |
| Zero rows                            | Either a trivial surface, or — far more likely — **nobody grounded anything.** Treat with suspicion.    |
| Zero `NEW` across a whole round      | **Saturation.** The implementation model is mined out for this surface.                                 |

That second row is worth dwelling on. If the business keeps overturning things the
Pattern Base **already knew**, the skill is fine and the run was sloppy. The fix
is to read Step 0 — not to add more patterns.

## Marking debt on the prototype itself

Anything the design shows that the business cannot back gets a visible `NEW` tag
**on the mock**, not just in the spec. A reviewer looking at a picture must be
able to tell which parts are real.

```
Total time on this: 11h 06m   [NEW]   ← the business does not model run duration
```

This is the cheapest defense against `P-05`-class theatre: **if you cannot name
the business event behind an element, you must draw the tag.**

## Why the log, and not just a good memory

The Pattern Base is the skill's long-term memory; the reality-check log is its
short-term one. Skipping the log does not merely lose a document — it breaks the
**C** (Closed Loop) of SCLPT, and the next session re-learns the same nine lessons
from scratch.
