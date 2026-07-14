# Pattern Base

> Read this file in full before a substantial product-design run. For a narrow
> question, inspect the relevant patterns and state the checked scope.
>
> **Propose before appending.** When evidence overturns an assumption that no
> pattern here predicted, record a candidate. Append only when repository edits
> are authorized and the lesson is general, deduplicated and reviewable. Each entry:
> **Symptom / The real case / Why it happens / How to detect it next time.**
>
> This is the **P** of SCLPT. It is a reviewed aid, not an exhaustive truth set.

## What belongs here, and what does not

Every pattern in this file is about **business semantics** — what the product
actually models, what a state _means_, what an action _does to the business_.

**Implementation semantics do not belong here.** "Reuse the existing spinner
component", "this refactor breaks a mounted modal", "prefer this hook over that
one" — all true, all important, all somebody else's file. A pattern earns its
place here only if it changes **what the product should be**, not how it is
built.

The test: _strip out every framework, table and component name. Is there still a
product insight left?_ If no, it is an engineering note in disguise.

---

## The spine: Cooper's three models

Everything below is one disease with different symptoms. The frame is Cooper's,
unmodified — see [layer-model.md](layer-model.md):

| Model                    | What it is                                                                  |
| ------------------------ | --------------------------------------------------------------------------- |
| **Implementation model** | How the product _actually works_: its concepts, states, events, obligations |
| **Represented model**    | What the interface _claims_ the product is                                  |
| **Mental model**         | What the user _believes_ it is                                              |

> **The represented model should be as close to the mental model as possible, and
> as far from the implementation model as necessary.**

Every pattern here is a failure to hold that line:

- **Class A** — the represented model inherited the implementation model's
  **vocabulary** instead of its meaning.
- **Class B** — the represented model and the implementation model simply
  **disagree** about what exists.
- **Class C** — the represented model follows the implementation model when it
  should be following the **mental** model.
- **Class D** — how to scope once the first three are settled.
- **Class E** — how human judgment relates to machine-produced evidence.

**Where to investigate the implementation model**: domain concepts, states and
events are strong evidence, but not the only evidence. Reconcile them with actual
service behavior, permissions, policy and production facts where relevant. Code
can be stale, accidental or incomplete.

---

## Class A — The business meaning is not what the name says

### P-01 — A state's business meaning is not its label

**Symptom**: you design around what a status _sounds like_.

**The real case**: a task status called `paused` was read as "the user suspended
this". Its actual business meaning is **"pending review — the agent finished a
step and is waiting for a human to approve it"**. The product surfaces it as
_Pending review_, and the board column for it is called _Needs input_. A design
built on "paused = suspended" would have put it in a "later" bucket, when it is
in fact the most urgent thing on the page — an agent is **blocked on you right
now**.

**Why it happens**: state names are chosen by whoever created the state, usually
early, usually for the machine. They drift from the business meaning and nobody
renames them.

**Detect**: for every state you put on screen, ask **"what does this state
oblige someone to do?"** — not "what does this word mean in English". If the
answer is "nothing", it is not a state worth surfacing. If it is "a human must
act", it is a queue.

### P-02 — An action's business consequence is not its label

**Symptom**: you treat an action as its most literal reading.

**The real case**: a "Request changes" action on an agent's deliverable looked
like _leave a comment_. Its real business consequence is: **it resolves the
item, and re-runs the agent with the comment as new input.** It is not feedback,
it is a **re-tasking**. The design had proposed a plain comment box — which
would have quietly turned a re-tasking into a note nobody acts on.

**Why it happens**: an action's label describes what the _user does_; its
business semantics describe what the _business does next_. The two are routinely
different, and only the second one matters for design.

**Detect**: for every action, complete the sentence _"after this click, the
business is now …"_. If you cannot, you do not know what the button does — and
you are about to design a different product than the one that exists.

### P-03 — The name and the concept have diverged

**Symptom**: you build a mental model out of a word.

**The real cases**, all in one product:

- A sidebar section named **Project** renders a **knowledge library**, and its
  "create" action makes a knowledge base. There is **no project concept in the
  business at all** — "Project" was an empty word. A whole design round was spent
  on "project progress" before anyone checked.
- The `@` mention menu has a category named **member** — which resolves to
  **agents**, not people. Selecting one dispatches work to an agent. A design
  that read "member" as "colleague" would have specified a collaboration feature
  that **does not exist in the business**.

**Why it happens**: names are the cheapest thing to change and therefore the
last thing anyone changes. The vocabulary rots while the concepts move.

**Detect**: never accept a name as evidence of a concept. Ask **"what business
event does this actually produce?"** If the answer does not match the noun, the
vocabulary is broken — and that is itself a finding worth reporting, because the
whole team is miscommunicating through it.

---

## Class B — The represented and implementation models disagree

### P-04 — Do not read the surface as evidence about the product

**Symptom**: the surface shows one kind of thing, so everyone concludes that is
all the product does.

**The real case**: a home surface showed only agent **errors**, so the team
reasoned about it as an error log and asked _"how do we make the error list
nicer?"_. The product in fact models **four** kinds of agent-to-human message —
a **decision** (the agent paused and needs a ruling), a **result** (a deliverable
awaiting acceptance), an **insight** (worth knowing, nothing to decide) and an
**error** — and produces all four every day. Three had simply never been
surfaced.

The surface was not an error log in need of polish. It was **a decision inbox with
three of its four channels switched off** — and the entire team's model of the
product had been formed by looking at the screen.

**Why it happens**: nothing mysterious. The scenarios were designed and built
before the interface caught up, which is ordinary. What is _not_ ordinary is how
completely a surface can define everyone's understanding of what the product is,
including the people who built it.

**Detect**: for every concept the surface touches, enumerate **all** of its
variants in the product, then ask _"which of these does the surface ignore, and is
there a reason?"_ Often the answer is **"no reason — nobody got to it"**. Check
this before inventing anything new; it is the cheapest win available and the
easiest to miss.

### P-05 — The surface promises a business event that does not exist

**Symptom**: an affordance that feels natural and cannot possibly do anything.

**The real case**: a design put an **"Accept task"** button on work someone had
assigned to you. But in this business, assignment is **immediate and
unilateral** — the moment a colleague assigns it, the task is yours. There is no
"offered, pending acceptance" state, because the business never modeled
delegation as a negotiation. The button would have been a lie: it implies you
could decline, and you cannot.

The honest actions are the ones that map to real business events: **Start** (it
becomes active work) or **Reassign** (it becomes someone else's).

**Why it happens**: the affordance is imported from another product's business
model — Jira-style accept/decline — without checking whether _this_ business has
the intermediate state that one has.

**Detect**: for every button, name the **business event** it produces. Not the
mutation — the event, in domain language: _"the task is now started"_, _"the
brief is now resolved"_. If you cannot name one, the button is theatre. Delete
it, or admit you are proposing a change to the business model (and say so out
loud — that is a real proposal, just an expensive one).

### P-06 — The business has no such concept, so this is not a design decision

**Symptom**: you treat a missing capability as a layout problem.

**The real case**: a team-collaboration design wanted a "what the team is
working on" feed, including conversations. But the business models
**per-member privacy for tasks and documents and nothing else** — conversations
have no notion of "mine vs the team's" at all. So "show the team the
conversations" is not a design choice that could be made tastefully. It is
**a business concept that does not exist**, and shipping the feature would have
been a privacy incident, not a bad layout.

Same shape, smaller: "unread" existed only as a **global** property of a
conversation, not a per-person one. A per-member unread badge was therefore not
a UI decision either — it was a request for a new business concept.

**Why it happens**: the surface can render anything, so absence of a _concept_
looks like absence of a _widget_. It is not.

**Detect**: for every thing you want to show, ask **"does the business have a
notion of who this belongs to / who has seen it / who may act on it?"** If not,
you are not designing — you are proposing a domain change. That is allowed, but
it must be said out loud (`P-11`), because it changes the cost by an order of
magnitude.

---

## Class C — How attention gets organized

These are judgment rules, and each one was earned by rejecting a plausible
alternative.

### P-07 — A home surface is a triage desk, not a dashboard

**Rule**: an inbox-like surface answers exactly one question — **"is this mine to
handle?"** Reading, analysis and browsing happen after the click, elsewhere.

**The rejected alternative**: a team dashboard — usage trends, member
leaderboards, throughput charts. Its fate is predictable: the manager looks for
two weeks, the members never look at all. A **"what happened"** surface has no
pull. A **"what is blocked on me"** surface does, because not looking has a cost.

**Test**: for every element on the page, ask _"if the user never clicks this,
does anything get stuck?"_ If no, it does not belong on this surface. It belongs
on a page someone visits **on purpose**.

### P-08 — Density follows decision cost

**Rule**: an item's size on screen should match **how much thinking it demands**
— never how much text its producer happened to write.

| The signal             | The form it takes                                              |
| ---------------------- | -------------------------------------------------------------- |
| Needs my decision      | Expanded: title + **one sentence** of reasoning + the actions  |
| Just needs to be known | One line: title, source, time. The detail appears **on click** |
| Needs nothing from me  | Collapse into a **count**. Only anomalies earn their own row   |

**The rejected alternative**: "make every card more compact". That trades
readability for density and loses both. The original surface's real failure was
a paragraph-length summary that was **too short to replace the document and too
long to scan** — the worst possible length. The fix was not to shorten it. It was
to decide, per item, _how much thinking this item demands_, and let that pick the
form.

### P-09 — Group by the action required, not by the entity that produced it

**Rule**: an agent saying _"I'm stuck, decide this"_ and a colleague saying
_"@you, look at this"_ are, **to the person receiving them, the same signal**.
They belong in one list, grouped by what the recipient must do — not split into
"agent stuff" and "people stuff".

**Why**: entity-shaped grouping is how the **system** sees the world. Action-
shaped grouping is how the **user** does. Only one of those is the user's problem.

**Corollary — sort by what is actually blocking, not by a priority field.** A
stuck decision is blocking work _right now_; a failed run has already stopped and
can wait. So failures sink to the bottom of the queue **even when their priority
field says urgent** — because "urgent" was written by the producer, and
"blocking" is a fact about the world.

---

## Class D — Scope and honesty

### P-10 — Prefer coherent value with lower domain risk

**Rule**: before scoping, sort every capability the design needs by **whether the
business already models it**:

| Bucket                                   | Meaning                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| ✅ **Already modeled, already exposed**  | Rearranging what is there                                   |
| ⚠️ **Already modeled, not yet exposed**  | Lower domain risk; engineering cost still needs validation  |
| ❌ **Not a concept in the business yet** | Requires domain expansion and explicit cost/risk assessment |

**Prefer a coherent ✅ + ⚠️ slice when it completes the user's job.** Do not ship
an incomplete or misleading slice merely because its concepts exist. A ❌ item can
be the right first investment when required for value, safety or semantic integrity.

**The real case**: a sweeping team-collaboration vision needed mentions,
annotations, presence and a project concept — **all ❌**. But the attention inbox
at its core was entirely ✅ + ⚠️: the four message kinds were already being
produced, and the running/unread work was already a business concept. That subset
shipped. The expensive half is still, correctly, being argued about.

**Detect**: if the first milestone requires a new concept, check the ⚠️ bucket
before committing. Then compare user value, risk, coherence and engineering cost
instead of treating concept existence as the cost estimate.

### P-11 — Name what you are _not_ building, and what it would cost

**Rule**: every ❌-bucket capability goes into the spec **by name, with its
reason**. Never silently dropped.

**Why**: silence reads as an oversight. A reviewer who notices the gap will
assume you missed it and re-open the discussion. A reviewer who reads _"per-run
duration is not shown: the business does not model a run's elapsed time, so this
needs a new concept"_ will either accept it or argue the cost — which is exactly
the conversation you want.

**The real case**: a prototype showed each run's elapsed time. The business has
no such concept — a run's duration is not modeled, anywhere. Writing that down
converted _"you forgot the timestamps"_ into _"we know, and here is the price"_.

---

## Class E — Human judgment and machine-produced evidence

### P-12 — The actor who closes the lifecycle defines the surface

**Symptom**: a surface called a report leads with the system's verdict, summary,
counts and execution history, while the human action that creates the terminal
business outcome is absent or secondary.

**The real case**: delivery acceptance had rich verification runs and generated
reports, so the first designs treated the surface as a finished report with
evidence attached. In the business, however, an acceptance becomes terminal only
when the user clicks **Accept delivery**. The verifier's `passed` result is advice;
the user's acceptance is the event. The honest surface is therefore a decision
workspace: what is safe to accept, what changed, what still deserves review, the
evidence needed for that judgment, and the final action. The complete report is a
drill-down, not the page's organizing principle.

**Why it happens**: machine outputs are numerous, named and easy to render; the
single human decision is often implemented later and looks like "just a button".
Design inherits the volume of the implementation model and mistakes it for the
importance of the business model.

**Detect**: for every review, approval or acceptance surface, ask **"who is
allowed to make this terminal, and what event does that action produce?"** If the
answer is a human action, organize the surface around the decision it supports.
Treat system verdicts as recommendations and evidence as decision material —
never as a substitute for the terminal event.

**Canonical anchor**: Cooper's goal-directed design and JTBD. The user's goal is
to make a defensible decision in this circumstance, not to inspect everything the
machine happened to produce.

### P-13 — Execution history is an audit model, not the default review model

**Symptom**: attempts, runs or evidence versions dominate the first screen because
they are the clearest structure in storage.

**The real case**: a multi-run acceptance was first represented as a Check × Run
matrix followed by an "evidence evolution" gallery. Both were accurate and useful
for deep investigation, but they made the user reconstruct the actual decision:
what was fixed, what remains risky, and whether the delivery is safe to accept.
The first screen instead needs exceptions and decision-relevant change: failed →
fixed proof, missing or stale evidence, and anything carried forward without a
rerun. Stable checks and their full run ledger remain available as audit detail.

**Why it happens**: chronology is objective and readily available, while deciding
which differences matter requires product judgment. Teams therefore expose the
event log and call the reconstruction work "transparency".

**Detect**: before putting chronology on the default surface, ask **"does the user
need to understand every attempt to act, or only the exceptions and changes that
alter today's decision?"** Default-expand the latter. Collapse unchanged success
into a count; put the complete ledger behind deliberate exploration.

**Canonical anchor**: Cooper's represented-vs-implementation model, plus JTBD's
circumstance. Runs are how the system executed; acceptability and exceptions are
how the user decides.

### P-14 — The domain constrains truth; the user's lookup object organizes the view

**Symptom**: every section is semantically correct, yet the user still cannot find
the thing they came for without translating domain language, combining several
modules or expanding hidden detail.

**The real case**: an acceptance design progressed from report summary, to evidence
gallery, to Check × Run ledger, to exception-first decision cards. Each correction
made the business semantics more accurate, but the user still wanted something
simpler: **the complete union of acceptance Check items, grouped by a familiar
category, with each item's final evidence directly underneath it**. They needed to
answer "Did Web interaction have a screenshot?" by scanning the Web check — not by
interpreting a system judgment, an evidence-evolution module or a run matrix. Runs
were useful only to show when a Check was introduced and where its final evidence
came from.

**Why it happens**: grounding the domain is hard and rewarding, so once the model
is understood the designer over-promotes it into the interface. A second failure
then follows: "user-centered" is interpreted as deciding what the user should care
about (exceptions, risk, recommendations) rather than exposing the objects the user
is actually trying to inspect. The result is curated but controlling — the system
answers a nearby question and hides the requested inventory.

**Detect**: before proposing sections, complete three sentences in the user's
language:

1. "I came here to find every \_\_\_."
2. "For each one, I need to see \_\_\_ without another click."
3. "I use \_\_\_ only to filter, explain provenance or investigate history."

Make the first blank the repeated item contract, attach the second directly to each
item, and demote the third. If users ask "does item X have proof?" and the proof is
in another module, the information architecture is wrong even when every business
fact is correct.

**Canonical anchor**: Cooper's represented-vs-implementation model and JTBD. The
domain model licenses claims; the circumstance reveals the user's retrieval object.
Neither authorizes the designer to substitute a curated summary for the inventory
the user came to inspect.
