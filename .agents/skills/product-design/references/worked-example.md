# Worked Example — the agent inbox

One complete trace. This is the session that seeded the Pattern Base, so every
mistake in it is real.

**The ask**: _"Look at our home surface. Nobody has put any design thought
into it. What should actually be there?"_

Note what the ask is **not**: not a bug, not a spec, not a requirement list. It is
a feeling. Everything below is the work of turning that into something buildable.

---

## Step 1 — Ground

The surface showed agent **errors**. So the team had been reasoning about it as an
error log — _"how do we make the error list nicer?"_

Grounding the domain turned that upside down. The business models **four kinds of
agent-to-human message**, and produces all four in production every day:

| Kind         | What it means, in the business                                            |
| ------------ | ------------------------------------------------------------------------- |
| **decision** | The agent has paused mid-work and needs a human to rule on something      |
| **result**   | The agent has produced a deliverable and is waiting for it to be accepted |
| **insight**  | The agent found something worth knowing. Nothing to decide                |
| **error**    | The run failed                                                            |

Each carries a priority, a set of possible responses, and its own linked
deliverables. Each has a full seen → answered lifecycle.

**Three of the four were never shown to anyone.**

The surface was not an error log in need of polish. It was **a decision inbox
with three of its four channels switched off** (`P-04`). That single finding was
worth more than everything else in the redesign combined — and no amount of
staring at the screenshot would ever have produced it.

Two more findings from the same pass, both about **meaning, not mechanism**:

- A task state named `paused` does not mean "the user suspended this". It means
  **an agent is blocked, waiting for a human** — the most urgent thing on the page
  (`P-01`).
- The action labelled "Request changes" does not leave a comment. It **re-tasks
  the agent**, feeding the comment back in as new input (`P-02`).

## Step 2 — Frame the user's view model

The initial view model was a hypothesis, not a user fact: someone opens the home
surface to find work blocked on their attention. The repeated lookup object was a
signal requiring a response, with its source and consequence attached. This was
supported by domain obligations but still required user validation; the later
human correction from “tasks” to “work, attention and goals” supplied direct
reported evidence.

## Step 3 — Diagnose

Three structural errors, none of them about taste:

1. **A decision inbox is being used as an error log.** (Above.)
2. **The surface is a triage desk and a reading room at once, and fails at both.**
   Every card carried a paragraph-length summary — _too short to replace the
   document, too long to scan_. Users neither read it nor skipped it cleanly
   (`P-07`, `P-08`).
3. **Signals were grouped by who produced them, not by what they demand.** What
   the user needs to know is _"what is blocked on me"_, not _"what did the agent
   say"_ (`P-09`).

## Step 4 — Align

Decisions surfaced one at a time. The two that changed the shape of the answer:

- _Is the primary axis attention (what needs me) or progress (what's moving)?_
  → **attention.** Progress is context; attention is the reason to open the page
  at all.
- _Do agent signals and human signals belong in one inbox or two?_ → **one.**
  An agent saying "I'm stuck" and a colleague saying "@you" are, to the person
  receiving them, the same signal (`P-09`).

The human overruled the first framing here. The agent had proposed organizing
everything around **tasks**; the reply was, roughly: _"organize it around the
work, and around attention and goals — not around one entity type."_ That
correction became `P-09`.

## Step 5 — Prototype

Six rounds in the real design system. Every round, the business overturned
something:

| Round | The prototype claimed             | The business said                                                      |
| ----- | --------------------------------- | ---------------------------------------------------------------------- |
| v3    | invented its own state vocabulary | `paused` already means _pending review_ — a human is blocking (`P-01`) |
| v4    | "Request changes" = a comment box | it re-tasks the agent (`P-02`)                                         |
| v5    | an "Accept task" button           | assignment is immediate; there is no state to accept from (`P-05`)     |
| v6    | each run's elapsed time           | the business does not model a run's duration at all (`P-11`)           |

**The prototype's job is not to be right. It is to be wrong in ways the business
can correct.** A round that only moves pixels means the grounding was skipped.

## Step 6 — Scope

| Bucket                                   | Capability                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ✅ **Modeled and exposed**               | The error channel. The existing response actions.                                                        |
| ⚠️ **Modeled, never exposed**            | **The other three message kinds.** Running work. Unread finished work. The task each message belongs to. |
| ❌ **Not a concept in the business yet** | Mentions of a person. Annotations. Presence. A project. A run's duration.                                |

**Recommended and shipped in this case: ✅ + ⚠️.** Together they formed a coherent
personal-inbox job. Nothing in the ❌ column was required for that slice. Every
excluded item went into the
spec by name, with its cost (`P-11`).

The redesign that began as a sweeping team-collaboration vision shipped as a
focused personal inbox — **not as a retreat, but because that was the part the
business already believed in** (`P-10`). The expensive half is still, correctly,
being argued about.

## Close — record coverage and propose learning

Nine assumptions overturned, nine `NEW` → the entire Pattern Base. That is the
cold-start signature (see [trace-schema.md](trace-schema.md#reading-the-log)).

**Coverage signal**: the inspected message variants, task states, response actions
and ownership concepts produced no further gaps late in the pass. That justified
shifting the next round toward user evidence; it did not prove the model exhausted.

**And every one of the nine rows is an implementation-model finding. Not one is
about the mental model.** That is the real verdict on this session: the half that
could be done from a desk was done well, and the half that requires a user was not
done at all. The next round's budget belongs there.

## What generalizes

1. **The biggest win was a switched-off capability, not a new one.** Check for one
   before inventing anything — it is the cheapest win available, and the easiest
   to miss, because the surface is what everyone (including the people who built
   it) mistakes for the product.
2. **Every prototype round should be falsified by the domain.** If it is not, you
   are decorating, not designing.
3. **"What does the business already believe in?" is the question that converts a
   vision into something that ships.**
