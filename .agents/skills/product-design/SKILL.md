---
name: product-design
description: 'Turn a vague product ask ("this page feels wrong", "we need a team view") into a grounded, shippable design — by first establishing what the business actually models, before proposing anything. Use when scoping a new surface, redesigning an existing one, or deciding what a feature should even be. Not for auditing a built screen (that is ux-audit) or for picking spacing and color (that is ux).'
argument-hint: '<surface or product ask>'
---

# Product Design

The upstream half of design: **deciding what to build and why**, before anyone
argues about spacing.

Its one non-negotiable rule:

> **Never design from the surface. Establish what the business actually models
> first.**

Every expensive mistake this skill exists to prevent has the same shape: a
surface that misrepresents its own business — promising an event the domain does
not have, hiding a capability the domain already supports, or naming a state
after the machine rather than after the obligation it creates. All three look
completely reasonable on a slide.

## Scope — business semantics only

This skill is about **what the product means**, not how it is built.

Component reuse, refactor hazards, framework conventions — real, important, and
**not here.** The test for anything entering this skill:

> Strip out every framework, table and component name. **Is there still a product
> insight left?**

If not, it belongs in an engineering skill.

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

A self-evolving system, wired per the SCLPT framework. Each element maps to a file
you must actually read and write:

| Element            | Here                                                     | What it does                                                                         |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **P** Pattern Base | [references/pattern-base.md](references/pattern-base.md) | The learned rules. **Read before every run. Append after every run.**                |
| **L** Layer Model  | [references/layer-model.md](references/layer-model.md)   | Cooper's three models — implementation / represented / mental                        |
| **T** Trace Schema | [references/trace-schema.md](references/trace-schema.md) | Every session leaves a **reality-check log**: assumption → what is true → who won    |
| **C** Closed Loop  | Step 6                                                   | Every overturned assumption becomes a new pattern                                    |
| **S** Saturation   | Step 6                                                   | A grounding round that overturns **nothing** = the implementation model is mined out |

Benchmarked against [references/canon.md](references/canon.md) — the works that
already named most of this, and the two things they did not.

**The loop in one line:** the reality-check log (T) is sorted by layer (L) and
compared against the pattern base (P); whatever the business overturned that the
pattern base did not predict is a new gap, which gets written back (C); when a
grounding round produces zero new gaps, that surface is saturated (S).

---

## The workflow

### Step 0 — Read the Pattern Base (mandatory, every run)

Read [references/pattern-base.md](references/pattern-base.md) and
[references/layer-model.md](references/layer-model.md) **in full** before touching
the product ask. They are the accumulated "you already got this wrong once" list.

Two that keep biting, up front:

- **The business probably models more than the surface shows.** Look for the
  switched-off capability before you invent a new one — it is the highest-leverage
  move available (`P-04`).
- **Names lie.** A state called `paused` that means _pending review_; a `Project`
  section that is a knowledge library; an `@member` that resolves to an agent.
  Ask what a thing **obliges** or **produces**, never what it is called
  (`P-01`, `P-03`).

### Step 1 — Ground: establish the business model

Before diagnosing anything, find out what the business actually is. Delegate this
— it is broad, read-only work.

Produce:

- **The concepts and states the business models** — all of them, not just the ones
  the surface renders. This is where the surprises live (`P-04`).
- **What each state obliges someone to do.** A state nobody must act on is not a
  queue; a state a human is blocking is (`P-01`).
- **What each action does to the business** — the event it produces, in domain
  language. Not the mutation (`P-02`).
- **Which concepts the business does _not_ have.** Absences are findings too, and
  they are the expensive ones (`P-06`).

The domain model is the evidence. Read it as a domain document — it is the most
honest statement the company has made about what it believes exists.

Never skip to Step 2 on a mental model of the product. The mental model is wrong;
that is the entire premise of this skill.

### Step 2 — Diagnose: name the structural error

A diagnosis is not "it looks dated". It must name something wrong **regardless of
taste**:

- The surface shows one of four kinds of thing, so a decision inbox reads as an
  error log (`P-04`).
- A button promises a business event that does not exist (`P-05`).
- The page is a triage desk and a reading room at once, and fails at both
  (`P-07`).

If you cannot name a structural error, you do not have a diagnosis — you have an
opinion. Go back to Step 1.

### Step 3 — Align: walk the decision tree, one question at a time

Do not present a finished solution. Surface the decisions that **change the shape
of the answer**, one at a time, each with a recommendation and its reasoning.
Settle the upstream ones before the downstream ones they constrain.

If a question can be answered by grounding, **go and ground it** — never spend the
user's turn on something the domain model already settles.

### Step 4 — Prototype against the real design system

Use [design-prototype](../design-prototype/SKILL.md). A prototype in the real
components with real tokens is the only honest way to argue about density and
hierarchy.

- **Mock data must be plausible.** Fake data hides the at-scale case.
- **Show the non-happy path.** Empty, blocked, and 100× are where the design gets
  decided.
- **Tag anything the business cannot back with `NEW`, on the mock itself.** A
  visible debt, not a silent lie.

Expect the first prototype to be wrong. That is its job — every correction is a
Pattern Base entry.

### Step 5 — Scope: what does the business already support?

Sort every capability the design needs:

| Bucket                                   | Meaning                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| ✅ **Already modeled, already exposed**  | Rearranging what is there                             |
| ⚠️ **Already modeled, not yet exposed**  | `P-04` territory — nearly free product                |
| ❌ **Not a concept in the business yet** | A domain change. An order of magnitude more expensive |

**Ship ✅ + ⚠️ first** (`P-10`). Not as a compromise — as a discipline. It forces
the design to be honest about what the business is _today_, and it puts a real
surface in front of users while the domain changes are still being argued about.

Every ❌ item goes into the spec **by name, with its cost** (`P-11`). Never
silently dropped — silence reads as an oversight and gets re-litigated in review.

### Step 6 — Close the loop (mandatory)

The session is done when the **system** got smarter, not when the PR opened:

1. **Write the reality-check log** into the spec (see
   [trace-schema.md](references/trace-schema.md)): every assumption the business
   overturned.
2. **For each one the Pattern Base did not predict**, append a new pattern —
   symptom / the real case / how to detect it next time. Check it against
   [canon.md](references/canon.md) first: _is this an instance of something already
   named, or genuinely new?_ Most of the time it is the former, and that is a good
   outcome.
3. **Record the saturation signal.** If a whole round overturned _nothing_, say
   so: the implementation model is mined out for that surface, and the next round
   belongs to the **mental** model — the one grounding cannot reach.

A session that ships a feature but teaches the system nothing has done half the
job.

---

## Deliverables

| Artifact              | Where                                                    | Template                                             |
| --------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Design spec           | `YYYY-MM-DD-<slug>-design.md`                            | [templates/design-spec.md](templates/design-spec.md) |
| Interactive prototype | Beside the spec                                          | via [design-prototype](../design-prototype/SKILL.md) |
| Reality-check log     | A section **inside** the spec                            | [trace-schema.md](references/trace-schema.md)        |
| New patterns          | [references/pattern-base.md](references/pattern-base.md) | append                                               |

## Anti-patterns

- **Designing from the screenshot.** It shows what renders, not what the business
  models.
- **Proposing a solution before the diagnosis names a structural error.**
- **Reading a state or an action by its name** instead of by what it obliges or
  produces.
- **Letting a missing concept masquerade as a layout problem** (`P-06`).
- **Dumping every open question at once**, or asking things the domain model
  already answers.
- **Letting engineering findings into the Pattern Base.** They are true and they
  belong somewhere else.
- **Shipping and not writing back.** The next session re-learns it all.

## Worked example

[references/worked-example.md](references/worked-example.md) — a full trace of one
real session: a surface that showed one of four kinds of agent message, the
assumptions the business overturned, and the subset that shipped because the
domain already supported it.
