# Canon

A Pattern Base without an external benchmark drifts into a list of _"things that
happened to us"_. This file is the benchmark: the small set of works that already
named most of what we keep rediscovering, plus an honest account of what they do
**not** cover.

Every new pattern must answer one question first:

> **Is this an instance of something the canon already named, or is it genuinely
> new?**

Most of the time the answer is _"already named"_. That is a good outcome — the
pattern gets an anchor, and the Pattern Base stays a **judgment system** instead
of a diary.

---

## The primary text — Cooper, _About Face_

**Why it is the spine**: Cooper's three-model frame is the axis every Class A and
Class B pattern runs on.

| Cooper's model           | In our language                                                |
| ------------------------ | -------------------------------------------------------------- |
| **Implementation model** | What the product actually models: its concepts, states, events |
| **Represented model**    | What the surface claims the business is                        |
| **Mental model**         | What the user believes it is                                   |

Cooper's central diagnosis — **the implementation model leaking into the
represented model** — is what `P-05` (an affordance for a business event that
does not exist) and `P-01`/`P-02` (a state or action surfaced by its machine name
rather than its business meaning) are instances of.

His **"dancing bear"** — software that is remarkable for working at all, and
miserable to use — is what a surface becomes when it is organized by what the
system produced rather than by what the user must do (`P-09`).

**Read it for**: goal-directed design; why the user's goal is not the same as
their task; why the represented model must be built from the business's meaning,
never from its mechanism.

## For scope — Singer, _Shape Up_

**Why**: Class D is Shape Up wearing different words.

| Shape Up            | In our language                                                                        |
| ------------------- | -------------------------------------------------------------------------------------- |
| **Appetite**        | Decide the budget before the solution, not after (`P-10`)                              |
| **Breadboarding**   | Design at the level of affordances and connections before pixels — our L0→L2 before L3 |
| **Rabbit hole**     | The ❌ bucket: a capability the business does not model yet (`P-10`, `P-11`)           |
| **Circuit breaker** | Name what you are not building, and stop (`P-11`)                                      |

**Read it for**: why "what can we build with the appetite we have" is a better
question than "what is the right solution", and why a fat-marker sketch beats a
polished mock when the concept is still moving.

## For intent — Jobs-to-be-Done

**Why**: L0 is the one layer no amount of grounding can answer, and it is the
layer this skill is weakest at. JTBD is the sharpest available tool for it:
_what job is the user hiring this surface to do, in what circumstance?_

The lever it gives us is **the circumstance**, not the persona. "A manager"
explains nothing; "someone opening the app at 9am to find out whether anything
broke overnight" explains the entire information architecture — and immediately
kills the dashboard (`P-07`).

**Read it for**: how to interrogate an L0 claim instead of asserting it.

## For presentation — Tidwell, _Designing Interfaces_

Already the benchmark of the [`ux`](../../ux/SKILL.md) skill, and it stays there.
L3 questions — density, hierarchy, patterns — belong to `ux` and `ux-audit`.
**This skill should not re-derive them.** If a finding is about how something
looks rather than what it means, it is in the wrong file.

---

## What the canon does **not** cover

Two things we keep hitting that no canonical text names. These are the Pattern
Base's actual contribution, and they should be defended as such.

### 1. The inverse leak — the represented model _under_-exposing the business

Cooper documented the leak in one direction: implementation detail escaping into
the interface. **We keep finding the opposite**: a business that models far more
than its surface admits.

The clearest case (`P-04`): a product modeled four kinds of agent-to-human
message — a decision to rule on, a deliverable to accept, an insight to note, an
error to fix — produced all four in production every day, and **rendered only the
errors**. The team had been designing "a better error list" for a surface that
was, in the domain, a decision inbox with three channels switched off.

Nobody wrote this one down because in the era the canon was written, **the
business model was small and the interface was where the ideas lived**. That has
inverted. In a system where autonomous agents generate business events
continuously, the domain routinely outruns the interface — and _finding the
unexposed capability is now the highest-leverage act in product design._

**This is why the Step-1 grounding pass exists**, and why it reads the domain
rather than the screen.

### 2. A missing concept is not a missing widget

`P-06`: when the business has no notion of _who this belongs to_ or _who has seen
it_, the corresponding feature is not a design decision that could have been made
more tastefully. It is a **domain change**, an order of magnitude more expensive,
and it must be priced as one.

The canon assumes the domain is a given and design happens on top of it. When
design and domain are being decided in the same room — which is the normal case
now — the skill needs a rule for telling them apart. That rule is `P-06`.

---

## Explicitly out of scope

**Software-engineering patterns do not belong in this canon, or in the Pattern
Base.** Component reuse, refactor hazards, framework conventions — all real, all
important, all a different discipline. A pattern earns its place here only if it
survives this test:

> Strip out every framework, table and component name. **Is there still a product
> insight left?**

If not, it is an engineering note wearing a design costume, and it belongs in the
engineering skills.
