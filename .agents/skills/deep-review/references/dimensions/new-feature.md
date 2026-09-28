---
id_prefix: feature
verify: true
skip_when: diff does not introduce a new product, operator, or platform capability
---

# New Feature Design

Review a new capability as one coherent product and domain model before judging its individual
files. This dimension covers design completeness that can look locally correct in every layer while
the feature as a whole uses the wrong concepts, persists the wrong state, or cannot answer whether
it works after release.

Do not run this dimension for a pure bug fix, refactor, deletion, or documentation change. A new
provider, backend, workflow, operator tool, or self-hosted capability counts as a feature even when
it does not add a new UI.

## Quick checklist

### Domain model, naming, and structure

- The capability should be statable in one sentence with clear domain nouns. Names across
  interfaces, implementations, configuration, jobs, telemetry, database objects, and docs must use
  the same vocabulary.
- Distinguish the capability from its implementation/provider and from its operational lifecycle.
  A provider-specific implementation must not use a broader platform name that implies behavior it
  does not provide. Compare sibling implementations as one naming system, not one symbol at a time.
- Check the nearest same-kind feature and the repository's domain skill before accepting new
  folders, services, repositories, or configuration surfaces. When multiple repositories or layers
  are possible, require an explicit product and engineering ownership decision; do not infer
  placement solely from the current deployment, technical portability, or lack of secrecy.
- Model capability availability separately from implementation/provider choice. Feature flags add
  or remove a capability; do not turn them into a multi-value provider or operating-mode registry.
  Temporary rollout flags need a removal condition, while a self-hosted product may deliberately
  keep capability flags as durable customization.
- Reserve dotted filename suffixes for established tool or runtime meanings such as `.test`,
  `.server`, or `.desktop`; use the repository's folder or hyphen convention for ordinary grouping.

### Database and lifecycle

- Challenge every new table, column, index, trigger, and persisted status: what durable fact does it
  own, who writes it, who consumes it, and when is it removed? Do not persist deployment or
  installation state that is already derivable from the authoritative system.
- Durable schema belongs in the normal migration path. Optional runtime installation is appropriate
  only for objects whose existence genuinely depends on enabling the capability; instances that do
  not enable the feature must not pay its ongoing write or operational cost.
- For development-stage migrations, verify the schema, generated SQL, snapshot, and migration
  history describe only the final model. Do not preserve compatibility with an unreleased draft.
- When migration cost or locking changes the rollout plan, measure the actual operation or a
  reversible equivalent on the project's actual Dev database. Record observed scale and duration,
  and label production extrapolation as inference rather than fact.

### Analytics and observability

Scope boundary: whether each added event is well-shaped and well-placed belongs to `observability`;
this section asks whether the feature as a whole can answer its outcome questions after release.

- Name the questions the feature must answer after release. Cover user-perceived performance,
  result/outcome quality, usage or continued intent, and the main failure mode where applicable;
  avoid adding signals that have no decision attached.
- Keep product analytics and backend telemetry separate: user events explain what people saw and
  chose, while metrics/traces explain latency, errors, throughput, and resource cost. A backend span
  alone cannot establish product quality or willingness to use the feature.
- Instrument the real entry and completion points, including empty/abandoned outcomes when they
  matter. Measurement failure must not change feature behavior.
- Keep event properties and metric labels bounded and consent-aware. Never record raw user content,
  search text, secrets, user IDs, document IDs, or other high-cardinality identifiers merely to make
  debugging easier.
- For a regression-prone main path, require one actionable alert tied to the user-visible failure
  and a concrete threshold; do not demand alerts for every internal step.

## Rule sources (deep mode: read before reviewing)

- The requirement or issue that defines the new capability and its intended users
- The nearest same-kind feature and its landing PR/commit
- The directly matching domain skill under `.agents/skills/`
- `.agents/skills/project-overview/SKILL.md` and repository `AGENTS.md` for ownership and structure
- `.agents/skills/db-migrations/SKILL.md` and `.agents/skills/drizzle/SKILL.md` when schema changes
- The observability and analytics paths used by the nearest same-kind feature

## How to check

1. Write a vocabulary map: capability, provider/variant, lifecycle operations, persisted entities,
   and telemetry names. Search the diff and adjacent callers for competing terms.
2. Draw the feature's complete path from entry point through runtime, persistence, background work,
   recovery, configuration, and docs. Report missing or misplaced lifecycle pieces.
3. For each database object, identify the durable fact and lifecycle it represents. Inspect the
   generated migration and use approved Dev evidence before recommending manual rollout work.
4. Turn every added event, metric, trace, and alert into a question it answers. Identify important
   product questions with no signal and signals that have no plausible decision.

## Violations

- The feature's vocabulary or structure makes capability, provider, and lifecycle concepts
  ambiguous across layers.
- A database object has no necessary durable responsibility, ships outside the correct migration or
  activation lifecycle, or changes rollout based on unmeasured cost assumptions.
- The feature cannot answer whether users received a fast, useful result or chose to keep using it,
  despite those outcomes being central to the requirement.
- Analytics or telemetry introduces sensitive/high-cardinality data, changes product behavior when
  recording fails, or creates non-actionable noise.

## Not violations

- A small feature whose existing domain model, persistence, and instrumentation already answer the
  relevant questions without new abstractions.
- Provider-specific names inside the provider implementation when the shared capability stays
  provider-neutral.
- No new table or analytics event when the feature genuinely needs neither.
- Cloud-only alert thresholds or operations kept outside a generic open-source implementation.

## Severity calibration

- P1: the model can corrupt durable state, make the feature inoperable for its intended deployment,
  or prevent detection of a requirement-critical failure after release.
- P2: misleading vocabulary, avoidable structure debt, or a missing useful-but-noncritical signal.
