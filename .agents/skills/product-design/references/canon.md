# Canon

A Pattern Base without an external benchmark drifts into a list of _"things that
happened to us"_. This file is the benchmark.

Every new pattern must answer one question before it is written down:

> **Is this an instance of something the canon already named, or is it genuinely
> new?**

**Almost always it is an instance.** That is the correct and useful outcome — the
pattern gets an anchor, and the Pattern Base stays a **judgment system** rather
than a diary.

The division of labour:

|                      | Gives you                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **The canon**        | The theory. Why the failure happens, in any product                                                    |
| **The Pattern Base** | The instances. What it looks like **in this product**, in our vocabulary, with the case that taught us |

Neither replaces the other. A pattern with no canonical anchor is usually not a
discovery — it is a pattern that has not been thought about hard enough.

---

## The primary text — Cooper, _About Face_

**It supplies our layer model outright.** The three models
([layer-model.md](layer-model.md)) are his, unmodified, because after twenty-five
years they are still the sharpest available frame for what goes wrong:

- **Implementation model** — how the product actually works
- **Represented model** — what the interface claims it is
- **Mental model** — what the user believes it is

And the goal, which is the entire job compressed into one sentence:

> **The represented model should be as close to the mental model as possible, and
> as far from the implementation model as necessary.**

Every pattern in Classes A and B is a failure to hold that line. Cooper's
**"dancing bear"** — software remarkable for working at all, and miserable to use
— is what a surface becomes when it is organized around what the system produced
rather than around what the user must do (`P-09`).

**Read it for**: goal-directed design; why a user's goal is not their task; why
the represented model must be authored from meaning, never derived from mechanism.

## For scope — Singer, _Shape Up_

Class D is Shape Up wearing different words.

| Shape Up            | Here                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| **Appetite**        | Decide the budget before the solution, not after (`P-10`)                 |
| **Breadboarding**   | Design at the level of affordances and connections before pixels          |
| **Rabbit hole**     | A capability the product does not model yet — priced accordingly (`P-10`) |
| **Circuit breaker** | Name what you are not building, and stop (`P-11`)                         |

**Read it for**: why _"what can we build with the appetite we have"_ is a better
question than _"what is the right solution"_.

## For the mental model — Jobs-to-be-Done

The mental model is the one layer no amount of grounding can reach, and it is
where this skill is weakest. JTBD is the sharpest tool available for it: _what
job is the user hiring this surface to do, in what circumstance?_

The lever it gives is **the circumstance**, not the persona. "A manager" explains
nothing. "Someone opening the app at 9am to find out whether anything broke
overnight" explains an entire information architecture — and immediately kills the
dashboard (`P-07`).

**Read it for**: how to interrogate a claim about what users want, instead of
asserting it from a schema.

## For presentation — Tidwell, _Designing Interfaces_

Already the benchmark of the [`ux`](../../ux/SKILL.md) skill, and it stays there.
Density, hierarchy, interface patterns — those questions belong to `ux` and
`ux-audit`. **This skill should not re-derive them.** If a finding is about how
something _looks_ rather than what it _means_, it is in the wrong file.

---

## Explicitly out of scope

**Software-engineering patterns do not belong in this canon, or in the Pattern
Base.** Component reuse, refactor hazards, framework conventions — all real, all
important, all a different discipline.

The test:

> Strip out every framework, table and component name. **Is there still a product
> insight left?**

If not, it is an engineering note wearing a design costume, and it belongs in the
engineering skills.
