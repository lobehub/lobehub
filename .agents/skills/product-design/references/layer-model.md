# Layer Model

The **L** of SCLPT. Four layers, each with its own kind of evidence and its own
authority. The point is not taxonomy — it is that **a claim from one layer
cannot settle a question in another**, and mixing them is how a design session
produces confident nonsense.

| Layer                       | Question                                    | Evidence                                     | Who decides                                       |
| --------------------------- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| **L0 Intent**               | Who, in what moment, needs what?            | The user's words; the scenario               | **Product / the human.** Code cannot answer this. |
| **L1 Data Capability**      | What can the system actually produce today? | Schema, model, router — `file:line`          | **The code.** Not negotiable.                     |
| **L2 Interaction Contract** | How does this product already do this?      | Canonical components, status maps, semantics | **The code.** Not negotiable.                     |
| **L3 Presentation**         | Density, hierarchy, tokens, motion          | The rendered prototype                       | Design taste, inside L1/L2 limits                 |

## The rule

> **Never answer an L1 or L2 question with an L3 argument, and never answer an
> L0 question with either.**

Concretely:

- "This button would feel natural here" (L3) does **not** establish that the
  state transition exists (L1). See `P-05` — that is exactly how a fake action
  ships.
- "Our approval card should be two clean buttons" (L3) does **not** override the
  fact that approval is already a numbered radio list with digit shortcuts (L2).
  See `P-02`.
- "The code has no `projects` table" (L1) does **not** settle whether the product
  _needs_ a project concept (L0). It settles the **cost**, and hands the decision
  back to the human.

## Cross-layer misjudgment — the four that actually happen

### 1. Designing an L3 affordance on top of L1 that does not exist

The most common and most expensive. The mock looks great; the data cannot feed
it. Everything in **Class B** of the pattern base is this failure.

**Guard**: for every element in the prototype, name the column or endpoint that
supplies it. If you cannot, mark it `NEW` on the mock itself — a visible debt,
not a silent lie.

### 2. Re-deciding an L2 contract that is already settled

You invent a spinner, a status glyph, an approval flow. It is not _worse_ than
the existing one — it is _a second one_, which is strictly worse than either.
All of **Class A** is this.

**Guard**: Step 1 of the workflow explicitly asks "which canonical systems exist
for the interactions I'm about to need?" Answer it before opening a prototype.

### 3. Letting L1 quietly veto L0

The code says a capability is expensive, so the design silently drops the
requirement. Now the product has been decided by the schema.

**Guard**: L1 reports **cost**, never verdicts. An ❌-bucket capability goes into
the spec as _"not this round, costs X"_ (`P-13`) — the human decides whether X
is worth paying. Dropping it without saying so is the design equivalent of
swallowing an exception.

### 4. Answering L0 from the screenshot

The surface shows what is rendered; it says nothing about who needs what. A
redesign that starts from "this looks dated" has skipped L0 entirely and will
optimize the wrong thing beautifully.

**Guard**: Step 2 demands a **structural** diagnosis. "It looks dated" is not
one. "It renders one enum value out of four, so a decision inbox reads as an
error log" is.

## Which layer is a given finding from?

When a grounding pass turns up a fact, tag it — the tag decides what you may do
with it.

| Finding                                                                   | Layer | What it licenses                                      |
| ------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| "`briefs.type` has four values; the UI renders one"                       | L1    | A scope opportunity — and probably the whole redesign |
| "`ExecutionStatus.ts` is the canonical status → icon map"                 | L2    | An import. Not a design decision.                     |
| "`topics` has no `visibility` column"                                     | L1    | A **red line** on what may be displayed               |
| "The approval card is a numbered radio list"                              | L2    | Replicate it. Do not 'improve' it in a prototype.     |
| "The summary paragraph is too long to scan, too short to replace the doc" | L3    | A density decision — inside L1/L2 limits              |
| "Owners won't look at a usage chart twice"                                | L0    | A product judgment — argue it, don't assert it        |

## Saturation, per layer

Saturation (**S**) is measured **per layer**, and they saturate at different
speeds:

- **L1 / L2 saturate fast.** One thorough grounding pass over a surface usually
  finds most of what the schema and the canonical components hold. When a second
  pass overturns nothing, they are mined out — stop spending budget there.
- **L3 saturates per iteration.** Each prototype round should produce fewer
  corrections than the last. If round 3 still produces as many as round 1, the
  problem is upstream: L1 or L2 was never actually grounded.
- **L0 never saturates.** Intent changes when the product changes. Do not treat a
  quiet L0 as a solved L0.

**The signal to record** (Step 6): _"grounding round N overturned zero
assumptions"_ — that surface's L1/L2 are done, and the next round's budget should
go to L0.
