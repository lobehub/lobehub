---
name: product-design
description: 'Turn a vague product ask ("this page feels wrong", "we need a team view") into a grounded, shippable design — by reverse-engineering what the code can actually do before proposing anything. Use when scoping a new surface, redesigning an existing one, or deciding what a feature should even be. Not for auditing a built screen (that is ux-audit) or for picking spacing and color (that is ux).'
argument-hint: '<surface or product ask>'
---

# Product Design

The upstream half of design: **deciding what to build and why**, before anyone
argues about spacing.

Its one non-negotiable rule:

> **Never propose from imagination. Reverse-engineer the code first.**

Every expensive mistake this skill exists to prevent has the same shape — a
designer (human or agent) invented something the codebase already had, or
designed an affordance for data that does not exist. Both look completely
reasonable on a slide and fall apart the moment someone tries to build them.

## Where this sits

| Skill                            | Question it answers                      | When                     |
| -------------------------------- | ---------------------------------------- | ------------------------ |
| **product-design** (this)        | What should this surface _be_, and why?  | Before there is a design |
| [ux](../ux/SKILL.md)             | How should it feel? What are the rules?  | While building           |
| [ux-audit](../ux-audit/SKILL.md) | Does the built screen honor those rules? | After it exists          |

`ux` is the **rulebook**, `ux-audit` **enforces** it on a finished surface, and
this skill decides **what surface to build at all**. Don't reach for it to fix a
button's padding.

## SCLPT — why this skill gets better over time

This is a self-evolving system, wired as SCLPT (see the framework doc in Linear,
BM-58). The five elements are not decoration; each maps to a file you must
actually read and write:

| Element            | Here                                                     | What it does                                                                        |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **T** Trace Schema | [references/trace-schema.md](references/trace-schema.md) | Every session leaves a **reality-check log**: assumption → code fact → who won      |
| **L** Layer Model  | [references/layer-model.md](references/layer-model.md)   | L0 intent / L1 data / L2 contract / L3 presentation — stops cross-layer misjudgment |
| **P** Pattern Base | [references/pattern-base.md](references/pattern-base.md) | The learned rules. **Read before every run. Append after every run.**               |
| **C** Closed Loop  | Step 6 below                                             | Every assumption the code overturned becomes a new pattern                          |
| **S** Saturation   | Step 6 below                                             | A round where the code overturns **nothing** = L1/L2 are mined out                  |

**The loop in one line:** the reality-check log (T) is sorted by layer (L),
compared against the pattern base (P); whatever the code overturned that the
pattern base did not predict is a new gap, which gets written back (C); when a
grounding round produces zero new gaps, that surface is saturated (S).

---

## The workflow

### Step 0 — Read the Pattern Base (mandatory, every run)

Read [references/pattern-base.md](references/pattern-base.md) and
[references/layer-model.md](references/layer-model.md) **in full** before
touching the product ask. They are the accumulated "you already got this wrong
once" list. Skipping them is how the same mistake ships twice.

Two that keep biting, up front:

- **The codebase probably already has it.** Status glyphs, loading spinners,
  approval flows, comment inputs — before designing one, grep for the canonical
  implementation. (`P-01`…`P-03`)
- **Names lie.** A `Project` group that renders a knowledge base; an `@member`
  mention that resolves to an agent. Read what the code _does_, not what it is
  called. (`P-07`)

### Step 1 — Ground: reverse-engineer the current surface

Before diagnosing anything, establish what is actually there. Delegate this —
it is broad, read-only search, exactly what a subagent is for.

Produce, with `file:line` for every claim:

- **What renders today** — the component tree, section by section.
- **Where each section's data comes from** — service → tRPC → model → table.
- **What the tables can actually produce** — every column, every enum value, not
  just the ones the UI uses today. This is where the surprises live (`P-04`).
- **Which canonical systems already exist** for the interactions you are likely
  to need — status visuals, loading, approvals, comments (`P-02`).

Never skip to Step 2 on a mental model of the code. The mental model is wrong.

### Step 2 — Diagnose: name the structural error

A diagnosis is not "it looks dated". It must name a **structural** mistake —
something that is wrong regardless of taste:

- The surface renders one enum value out of four, so a decision inbox reads as
  an error log (`P-04`).
- A button offers a state transition the data model does not have (`P-05`).
- The page tries to be both a triage desk and a reading room, and fails at both
  (`P-09`).

If you cannot name a structural error, you do not have a diagnosis yet — you
have an opinion. Go back to Step 1.

### Step 3 — Align: walk the decision tree, one question at a time

Do not present a finished solution. Surface the decisions that **change the
shape of the answer**, one at a time, each with a recommendation and its
reasoning. Settle upstream decisions before the downstream ones they constrain.

If a question can be answered by reading the code, **read the code** — never
spend the user's turn on something a grep would settle.

In this repo, the requirement-debate workflow itself is a separate skill
(`battle`, cloud-side). This step is its design-facing counterpart: same rule,
one question at a time, recommendation attached.

### Step 4 — Prototype against the real design system

Use [design-prototype](../design-prototype/SKILL.md). A prototype in the real
components with real tokens is the only honest way to argue about density and
hierarchy — a picture of a design is not a design.

Two rules that earn their keep:

- **Mock data must be plausible.** Fake data hides overflow, truncation, and
  the 100-parallel-runs case.
- **Show the non-happy path.** Empty, error, and at-scale states are where the
  design actually gets decided.

Expect the first prototype to be wrong in ways the code will tell you about.
That is the point — every correction is a Pattern Base entry.

### Step 5 — Scope: the three-bucket audit decides what ships

This is the step that turns a design into a plan. Sort every capability the
design needs into exactly three buckets:

| Bucket                   | Meaning                                         | Cost      |
| ------------------------ | ----------------------------------------------- | --------- |
| ✅ **Available now**     | An existing query/endpoint already returns it   | zero      |
| ⚠️ **Blocked by scope**  | The data exists but a predicate/select hides it | cheap     |
| ❌ **Needs a new model** | No table, no column, no endpoint                | expensive |

Then **ship the subset that needs zero new tables first.** Not as a compromise —
as a discipline. It forces the design to be honest about what is real, and it
gets a working surface in front of users while the expensive parts are still
being argued about (`P-07`).

Anything in ❌ goes into the spec as an explicit **"not in this round, and here
is exactly why"** — never silently dropped, or a reviewer will read it as an
oversight.

### Step 6 — Close the loop (mandatory)

The session is not done when the PR is open. It is done when the system got
smarter:

1. **Write the reality-check log** into the spec (see
   [trace-schema.md](references/trace-schema.md)): every assumption the code
   overturned, with the `file:line` that overturned it.
2. **For each overturned assumption the Pattern Base did not already predict**,
   append a new pattern (`P-nn`) — symptom / the real example / how to detect it
   next time.
3. **Record the saturation signal.** If a whole grounding round overturned
   _nothing_, say so in the spec: that surface's L1/L2 are mined out, and the
   next round should spend its budget on L0 (intent) instead.

A design session that ships a feature but teaches the system nothing has done
half the job.

---

## Deliverables

| Artifact              | Where                                                    | Template                                             |
| --------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Design spec           | The repo's spec directory, `YYYY-MM-DD-<slug>-design.md` | [templates/design-spec.md](templates/design-spec.md) |
| Interactive prototype | Beside the spec                                          | via [design-prototype](../design-prototype/SKILL.md) |
| Reality-check log     | A section **inside** the spec                            | [trace-schema.md](references/trace-schema.md)        |
| New patterns          | [references/pattern-base.md](references/pattern-base.md) | append                                               |

## Anti-patterns

- **Designing from the screenshot.** The screenshot shows what renders, not what
  the data could render. Read the schema.
- **Proposing a solution before the diagnosis names a structural error.**
- **Inventing a second way to do something the codebase already does once.**
- **Dumping every open question at once**, or asking things a grep answers.
- **Making the scope call on taste** instead of the three-bucket audit.
- **Shipping and not writing back.** The next session then re-learns the same
  lesson from scratch.

## Worked example

[references/worked-example.md](references/worked-example.md) — a full trace of
one real session: a home surface that rendered one brief type out of four, the
assumptions the code overturned along the way, and the shipped subset that
needed zero new tables.
