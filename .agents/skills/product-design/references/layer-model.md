# Layer Model

The **L** of SCLPT. Four layers, each with its own kind of evidence and its own
authority. The point is not taxonomy — it is that **a claim from one layer cannot
settle a question in another**, and mixing them is how a design session produces
confident nonsense.

| Layer                 | Question                                                      | Evidence                                    | Who decides                                         |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| **L0 Scenario**       | Who, in what circumstance, is hiring this surface to do what? | The user's words; the job to be done        | **The human.** No amount of grounding answers this. |
| **L1 Business nouns** | What concepts, states and roles does the business _have_?     | The domain model, read as a domain document | **The business.** Not negotiable.                   |
| **L2 Business verbs** | What does each action actually _do to the business_?          | The events an action produces               | **The business.** Not negotiable.                   |
| **L3 Representation** | How is it shown — density, hierarchy, form?                   | The rendered prototype                      | Design judgment, inside L1/L2's limits              |

**L1 is nouns and states. L2 is verbs and consequences.** They are separated
because they fail differently: L1 failures are _"the concept isn't there"_
(`P-06`), L2 failures are _"the button doesn't do what it says"_ (`P-02`, `P-05`).

## Where L1 and L2 are written down

In the schema, the state machines, the events.

**Not because implementation matters** — this skill has nothing to say about
implementation. Because **that is the most honest statement the company has ever
made about its own domain.** Marketing copy is aspirational; roadmaps are
aspirational; the schema is what the business _actually_ believes exists. Read it
as a domain document.

The corollary is a filter: if a fact you dug up carries no business meaning —
which component renders the spinner, how a module is wired — **it is not an L1 or
L2 finding at all.** It is engineering trivia, and it does not enter this system.

## The rule

> **Never answer an L1 or L2 question with an L3 argument, and never answer an L0
> question with either.**

Concretely:

- _"This button would feel natural here"_ (L3) does **not** establish that the
  business event exists (L2). That is exactly how a fake affordance ships
  (`P-05`).
- _"The business has no project concept"_ (L1) does **not** settle whether the
  product _needs_ one (L0). It settles the **cost**, and hands the decision back
  to the human.
- _"The state is called `paused`"_ is not an L1 finding at all — it is a word.
  The L1 finding is **what that state obliges someone to do** (`P-01`).

## Cross-layer misjudgment — the four that actually happen

### 1. Designing an L3 affordance on top of an L1/L2 that does not exist

The most common and most expensive. The mock looks great; the business cannot
back it. All of **Class B** is this.

**Guard**: for every element in the prototype, name the business concept or event
behind it. If you cannot, mark it `NEW` **on the mock itself** — a visible debt,
not a silent lie.

### 2. Reading a state or action by its name instead of its meaning

`paused` sounds like "suspended" and means "a human is blocking the agent".
"Request changes" sounds like a comment and means "re-task the agent". Every
design built on the word instead of the meaning is a design for a different
product. All of **Class A** is this.

**Guard**: for every state, _what does it oblige someone to do?_ For every
action, _after this click, the business is now …?_ If you cannot finish either
sentence, you have not grounded it.

### 3. Letting L1 quietly veto L0

The business does not model the concept, so the design silently drops the
requirement. The product has now been decided by the schema — which is exactly
backwards.

**Guard**: L1 reports **cost**, never verdicts. A missing concept goes into the
spec as _"the business does not model X; adding it costs Y"_ (`P-11`), and the
human decides whether Y is worth paying. Dropping it in silence is the design
equivalent of swallowing an exception.

### 4. Answering L0 from the screenshot

The surface shows what is rendered; it says nothing about who needs what, or
when. A redesign that starts from _"this looks dated"_ has skipped L0 entirely,
and will optimize the wrong thing beautifully.

**Guard**: the diagnosis must be **structural**. _"It looks dated"_ is not one.
_"It shows one of four message kinds, so a decision inbox reads as an error log"_
is.

## Which layer is a given finding from?

The tag decides what you may do with it.

| Finding                                                                  | Layer | What it licenses                                       |
| ------------------------------------------------------------------------ | ----- | ------------------------------------------------------ |
| "The business models four kinds of agent message; the surface shows one" | L1    | A scope opportunity — and probably the whole redesign  |
| "`paused` obliges a human to review, not to wait"                        | L1    | A queue, not a 'later' bucket                          |
| "'Request changes' re-tasks the agent; it is not a comment"              | L2    | Design a re-tasking, not a comment box                 |
| "There is no 'offered, pending acceptance' state for assigned work"      | L2    | Kill the Accept button. It is theatre.                 |
| "Conversations have no notion of belonging to a member"                  | L1    | A **red line** — this is a domain change, not a layout |
| "The summary is too long to scan, too short to replace the document"     | L3    | A density decision — inside L1/L2's limits             |
| "Nobody opens a dashboard twice"                                         | L0    | A product judgment — argue it, don't assert it         |
| "This spinner is implemented as an SVG animation"                        | —     | **Not a finding.** No business meaning. Discard.       |

That last row is the filter. Most things you can learn from a codebase are not
product findings, and letting them in is how a Pattern Base turns into a
changelog.

## Saturation, per layer

Saturation (**S**) is measured **per layer**, and they saturate at different
speeds:

- **L1 / L2 saturate fast.** One thorough pass over a domain usually surfaces most
  of what it models. When a second pass overturns nothing, they are mined out —
  stop spending budget there.
- **L3 saturates per iteration.** Each prototype round should produce fewer
  corrections than the last. If round 3 produces as many as round 1, the problem
  is upstream: L1 or L2 was never actually grounded.
- **L0 never saturates.** Intent changes when the business changes. A quiet L0 is
  not a solved L0 — it is an unexamined one.

**The signal to record** (Step 6): _"this round's grounding overturned zero
assumptions"_ — L1/L2 are done for this surface, and the next round's budget
belongs to L0.
