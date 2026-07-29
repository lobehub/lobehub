---
name: product-design
description: 'Turn a vague product ask ("this page feels wrong", "we need a team view") into a grounded, shippable design by establishing business semantics and the user task before proposing a surface. Use when scoping a new surface, redesigning an existing one, or deciding what a feature should be. Not for auditing a built screen (ux-audit) or choosing visual details (ux).'
---

# Product Design

Decide **what to build and why** before arguing about spacing.

Two rules are non-negotiable:

> **Never design from the surface. Establish what the business actually models
> first.**

> **Never turn the business model into the information architecture. The domain
> constrains what the surface may claim; the user's retrieval and decision task
> determines how the surface is organized.** (`P-14`)

This skill handles product meaning first. It may hand a grounded frame to `ux` or
`design-prototype`, but discovery does not require implementation or a prototype.
Strip out every framework, table and component name: if no product insight remains,
the finding belongs in an engineering skill.

## Relationship to other skills

| Skill                                            | Question                                      | When                        |
| ------------------------------------------------ | --------------------------------------------- | --------------------------- |
| **product-design**                               | What should this surface be, and why?         | Before or during framing    |
| [ux](../ux/SKILL.md)                             | How should the interaction behave and feel?   | While designing or building |
| [ux-audit](../ux-audit/SKILL.md)                 | Does the built surface honor those rules?     | After it exists             |
| [design-prototype](../design-prototype/SKILL.md) | How can a materialized interaction be tested? | When a prototype is useful  |

## Select the smallest run mode

| Mode            | Finish line                                                                  |
| --------------- | ---------------------------------------------------------------------------- |
| **Discover**    | Evidence map, business model, user-model hypotheses and structural diagnosis |
| **Frame**       | Discover + view model, information architecture, scope and open decisions    |
| **Materialize** | Frame + a requested spec and/or prototype                                    |

Do not create or modify artifacts unless the user asked for a design artifact,
prototype or repository change.

For a substantial run, read [references/pattern-base.md](references/pattern-base.md)
and [references/layer-model.md](references/layer-model.md) in full. For a narrow
question, inspect only the relevant patterns and state what scope was checked.

## Step 1 — Ground the business model

Establish what is true before diagnosing the surface. For broad repositories,
parallelize independent evidence areas when delegation is available and useful;
the primary agent remains responsible for reconciling contradictions.

Produce:

- Concepts, roles and states, including variants the current surface hides (`P-04`).
- Who produces the terminal business fact and what closes the lifecycle (`P-12`).
- What each state obliges someone to do (`P-01`).
- What business event each action produces (`P-02`).
- Concepts the business does not have (`P-06`).
- Evidence sources, contradictions and confidence.

Treat domain types and state machines as strong evidence, not the sole source of
truth. Check relevant service behavior, permissions, policy, production facts and
user evidence when available. Code can be stale, accidental or incomplete.

Never proceed from the team's assumed model of the product. Treat it as a
hypothesis until checked against domain and user evidence.

## Step 2 — Frame the user's view model

Grounding constrains what the product may claim; it does not determine how a
person should see it. Separate observed user evidence from design hypotheses:

- **Circumstance and job** — “When I open this, I need to …”.
- **Lookup objects** — stable things the user scans, compares or inspects.
- **Attached proof** — what verifies each object without reconstructing joins.
- **First scan** — the 2–4 questions answered without a click.
- **Secondary dimensions** — chronology, provenance, runs and internal states;
  keep them as filters or drill-down unless the job is execution audit.
- **Evidence and confidence** — mark claims as observed, reported or inferred;
  state how consequential assumptions can be validated.

| Model                 | Role in design                                                     |
| --------------------- | ------------------------------------------------------------------ |
| Business/domain model | Defines truth, validity, completeness and red lines                |
| User view model       | Defines grouping, ordering, labels and default expansion           |
| Execution model       | Supplies provenance and audit detail; never gets the page for free |

Do not proceed while proposed top-level sections are merely domain or execution
nouns such as `runs`, `reports`, evidence versions or table names. Rewrite them in
the objects the user is trying to find (`P-14`).

## Step 3 — Diagnose the structural error

Name something wrong regardless of taste, for example:

- A decision inbox exposes only errors, so it reads as an error log (`P-04`).
- A button promises a business event that does not exist (`P-05`).
- One page is both triage desk and reading room, and fails at both (`P-07`).

If no structural error can be supported by evidence, report that instead of
manufacturing a diagnosis.

## Step 4 — Align decisions by dependency

Surface only decisions that change the shape of the answer. For each, give a
recommendation, evidence and consequence. Resolve upstream decisions before the
downstream ones they constrain.

Ask a blocking question separately when its answer would materially change the
work; group independent decisions in one memo. When the user authorizes autonomous
progress, proceed with the recommended default and label the assumption. Never ask
the user for something available through grounding.

For review, approval or acceptance surfaces, establish first whether the system or
a human decision closes the lifecycle (`P-12`).

## Step 5 — Prototype when it resolves uncertainty

Use [design-prototype](../design-prototype/SKILL.md) only when the user requests a
prototype or interaction, density or hierarchy cannot be resolved honestly in a
written frame. This belongs to Materialize mode.

- Use plausible data and include empty, blocked and at-scale states.
- Tag anything unsupported by the business with `NEW` on the mock.
- Treat corrections as evidence. They become Pattern Base candidates only when
  they generalize beyond the current surface.

## Step 6 — Scope honestly

| Bucket                         | Meaning                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| ✅ Already modeled and exposed | Rearranging an existing capability                          |
| ⚠️ Modeled, not exposed        | Lower domain risk; engineering cost still needs validation  |
| ❌ Not modeled                 | Requires domain expansion and explicit cost/risk assessment |

Prefer a coherent ✅ + ⚠️ slice when it solves a complete user job. Do not ship an
incomplete or misleading slice merely because its concepts already exist. A ❌
capability may be the right first investment when required for value, safety or
semantic completeness (`P-10`).

Name every ❌ item and its likely cost drivers in the spec (`P-11`). Do not silently
drop it, but do not pretend its cost can be inferred from the domain model alone.

## Close — record coverage and propose learning

Close at the level authorized by the user:

1. If producing a spec, include the reality-check log from
   [references/trace-schema.md](references/trace-schema.md). For read-only work,
   report important assumptions and evidence in the response instead of writing.
2. Compare unexpected findings with [references/canon.md](references/canon.md) and
   propose a Pattern Base candidate only when the lesson is general.
3. Append to [references/pattern-base.md](references/pattern-base.md) only when
   repository edits are authorized and the candidate is deduplicated and
   reviewable.
4. Record the coverage signal: sources and lifecycle areas checked, unavailable
   evidence, remaining low-confidence claims, and whether a new gap was found.

Zero new gaps means only that none were found within the inspected scope. It does
not prove that the implementation or mental model is exhausted.

## Deliverables

| Artifact              | When                                       | Template/location                                                                      |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Design spec           | Requested in Materialize mode              | [templates/design-spec.md](templates/design-spec.md); use a user-specified path or ask |
| Interactive prototype | Requested or needed to resolve uncertainty | Beside the spec, via `design-prototype`                                                |
| Reality-check log     | Inside a produced spec                     | [references/trace-schema.md](references/trace-schema.md)                               |
| Pattern candidate     | A general, unexpected lesson emerges       | In the spec/response; append only after review and authorization                       |

## Anti-patterns

- Designing from a screenshot or treating the domain model as the sitemap.
- Reading a state or action by its label rather than its obligation or event.
- Inferring the user model from code and presenting it as observed truth.
- Treating a missing concept as a layout problem.
- Asking questions the available evidence already answers.
- Treating concept existence as an engineering cost estimate.
- Automatically prototyping, writing a spec or mutating the Pattern Base.
- Adding local corrections or engineering findings to shared product guidance.

For a complete example, read
[references/worked-example.md](references/worked-example.md).
