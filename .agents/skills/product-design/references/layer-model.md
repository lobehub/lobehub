# Layer Model — the three models

The **L** of SCLPT. We do not invent a layer model; Cooper already wrote the
right one, and it has held up for twenty-five years.

| Model                    | What it is                                                                    | The evidence for it                  | Who has authority                                       |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| **Implementation model** | How the product **actually works**: its concepts, states, events, obligations | The domain model, the state machines | **The system.** Not arguable.                           |
| **Represented model**    | What the interface **claims** the product is                                  | The surface; the prototype           | **Design.** This is the only one we author.             |
| **Mental model**         | What the user **believes** it is                                              | What users say and do                | **The user.** It cannot be inferred from the other two. |

And Cooper's goal, which is the whole job in one line:

> **The represented model should be as close to the mental model as possible, and
> as far from the implementation model as necessary.**

Every pattern in the Pattern Base is a failure to hold that line.

## Where the implementation model is written down

In the domain model — the concepts, the states, the events.

**Not because implementation matters.** This skill has nothing to say about how
software is built. Because that is **the most honest statement the company has
ever made about what it believes exists**. Marketing copy is aspirational;
roadmaps are aspirational; the domain model is what the product _actually_
commits to. Read it as a domain document.

The corollary is a filter: a fact that carries **no business meaning** — which
component draws the spinner, how a module is wired — **is not a finding about the
implementation model at all.** It is a fact about the _code_, which is a different
thing entirely, and it does not enter this system.

## Cross-model misjudgment — the four that actually happen

This is what the layer model is _for_. Each one is a specific way of using
evidence from one model to settle a question that belongs to another.

### 1. Inferring the implementation model from the represented model

**"The surface doesn't show it, so the product must not do it."**

The most costly, and the most invisible — because it feels like observation, not
inference. A surface showed only agent errors, so the whole team reasoned about
it as an error log. The product in fact modeled four kinds of agent-to-human
message and produced all four daily; three had simply never been surfaced.

There is nothing profound about _why_ — the scenarios were designed and built
before the interface caught up, which is ordinary. What is not ordinary is how
completely the team's model of the product was formed by looking at the screen.

**Guard**: never read the surface as evidence about the product. Ground the
implementation model directly, every time (`P-04`).

### 2. Building the represented model out of the implementation model

Cooper's central disease. The interface mirrors the machine: it inherits the
machine's vocabulary (`paused`, which actually means _a human is blocking an
agent_), its groupings (by producing entity, not by required action), and its
shape.

**Guard**: the represented model is authored, not derived. For every state, ask
what it **obliges someone to do**; for every action, what it **produces**. Design
from that, not from the name (`P-01`, `P-02`, `P-09`).

### 3. Representing something the implementation model does not have

The mirror image of #2, and it ships as theatre: an "Accept task" button on work
that was already, unilaterally, assigned to you. The affordance implies a choice
the product does not model.

**Guard**: for every element, name the business event behind it. If you cannot,
mark it `NEW` **on the prototype itself** — a visible debt, not a silent lie
(`P-05`, `P-06`).

### 4. Inferring the mental model from either of the other two

**The one nobody notices they are doing.**

"The product models four kinds of message, so users think in four kinds." No.
"The surface has always been an error log, so that is what users expect." No. The
mental model is the only one that **cannot be grounded** — not in the domain, not
in the screen. It comes from the user, and from nowhere else.

**Guard**: a claim about what users believe or want is a **claim**, and it must
be argued or observed — never asserted from a schema or a screenshot. When the
work has produced zero findings about the mental model, **say so**; that is not a
clean bill of health, it is an unexamined layer.

## Tagging a finding

Every row in the [reality-check log](trace-schema.md) is tagged with the model it
is a fact about. The tag decides what the finding licenses.

| Finding                                                                 | Model          | What it licenses                                      |
| ----------------------------------------------------------------------- | -------------- | ----------------------------------------------------- |
| "The product models four kinds of agent message; the surface shows one" | implementation | A scope opportunity — possibly the whole redesign     |
| "`paused` obliges a human to review; it does not mean 'suspended'"      | implementation | A queue, not a 'later' bucket                         |
| "'Request changes' re-tasks the agent; it is not a comment"             | implementation | Design a re-tasking, not a comment box                |
| "There is no 'offered, pending acceptance' state"                       | implementation | Kill the Accept button. It is theatre.                |
| "Conversations have no notion of belonging to a person"                 | implementation | A **red line** — a domain change, not a layout choice |
| "The summary is too long to scan, too short to replace the document"    | represented    | A density decision                                    |
| "Nobody opens a dashboard twice"                                        | **mental**     | A claim. Argue it or observe it — never assert it.    |
| "This spinner is drawn with an SVG animation"                           | —              | **Not a finding.** No business meaning. Discard.      |

The last row is the filter. Most of what you can learn from a codebase is not a
product finding, and letting it in is how a Pattern Base turns into a changelog.

## Saturation, per model

Saturation (**S**) is measured per model, and they saturate at very different
speeds:

- **The implementation model saturates fast.** One thorough grounding pass usually
  surfaces most of what the product models. When a second pass overturns nothing,
  it is mined out — stop spending budget there.
- **The represented model saturates per iteration.** Each prototype round should
  produce fewer corrections than the last. If round three produces as many as
  round one, the problem is upstream: the implementation model was never actually
  grounded.
- **The mental model never saturates**, and it is the one this skill is weakest at.
  Grounding cannot touch it. A session with zero mental-model findings has not
  finished — it has only done the half that could be done from a desk.
