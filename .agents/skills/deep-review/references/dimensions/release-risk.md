---
id_prefix: risk
verify: true
skip_when: diff touches no DB schema/migration, no schemaless persisted payload, no queue/workflow payload or cron schedule, no config or env dependency, no outbound sender, no prompt/tool-description text, no shared component or package public API, no high-frequency user surface, and carries a single obvious purpose
---

# Release Risk

Judge recovery cost when correct-looking code turns out to be wrong after deployment. Findings must
name the concrete rollback, repair, or blast-radius consequence; reach alone is not a defect.

## Quick checklist

- **Persisted state**: destructive or data-mutating migrations, constraints against populated data,
  schemaless payload changes (`jsonb`, cache objects, client persistence, stored manifests), code
  rollback that cannot run against the migrated state, or an undocumented deploy order.
- **Dev-cycle drift**: this PR creates and later reworks the same schema object, carries local-only
  compatibility statements, references schema no committed migration creates, or collides with
  trunk migration ordering.
- **Deploy-moment state**: consumers reject payloads already queued by the old code, workflow step
  positions change underneath in-flight runs, scheduled jobs overlap or process a production-scale
  backlog, required configuration is absent from a target, or bulk writes fan out to irreversible
  outbound effects.
- **Prompt surface**: system/tool/parameter text or assembly order changes model behavior without an
  eval, representative transcript, or staged rollout; default prompt changes disagree with
  persisted copies.
- **Rollback granularity**: a user-visible, incompletely testable main-path change can only be undone
  by reverting a large PR even though a scoped runtime flag could provide staged rollout and fast
  disablement.
- **Shared and first-minute surfaces**: an established contract or interaction changes across a
  measured set of call sites or a surface most users reach immediately, with no rollout control.
- **PR purity**: a large or risky sub-requirement is independently buildable and deployable but
  bundled with unrelated work, forcing one review and rollback unit.

Read every relevant routed reference below before reviewing. Do not read unrelated references:

| Changed surface                                                                    | Required reference                                                         |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Migration, schema, persisted object, queue/workflow, cron, config, outbound sender | [`../release-risk/persisted-state.md`](../release-risk/persisted-state.md) |
| Prompt, tool/parameter description, context assembly, persisted prompt default     | [`../release-risk/prompt-surface.md`](../release-risk/prompt-surface.md)   |
| Shared API/component, first-minute UI, feature flag, mixed PR scope                | [`../release-risk/rollout-surface.md`](../release-risk/rollout-surface.md) |

## Two output shapes

- Emit an `issues` finding when the code or diff proves a recovery hazard.
- Emit a `release_checks` item when safe deployment depends on production or external state the repo
  cannot answer, such as existing row shape, live configuration, or current queue contents.

A release check is not a weak finding. Additive and reversible migrations with no concrete ordering
or production-state dependency produce neither output.

## Rule sources (deep mode: read only when the touched surface requires them)

- `.agents/skills/db-migrations/SKILL.md`, `.agents/skills/drizzle/SKILL.md` — schema and migration
  changes
- `.agents/skills/upstash-workflow/SKILL.md` — queue and workflow changes
- `.agents/skills/builtin-tool/SKILL.md`, `.agents/skills/agent-tracing/SKILL.md` — prompt and tool
  behavior
- `.agents/skills/react/SKILL.md` — shared UI surfaces
- `.agents/skills/pr/SKILL.md` — independently shippable PR splits

## How to check

1. Classify the touched surfaces and read only their routed references and rule sources.
2. Write the actual recovery procedure for every candidate finding.
3. Separate evidence in code from unknown production state; route the latter to `release_checks`.
4. Keep dimension ownership sharp: locking/cost belongs to `performance`, design quality to `ux`,
   abstraction ownership to `reuse-architecture`, and PR metadata to `workflow`.

## Severity and likelihood

- **P0**: catastrophic and effectively irreversible data loss, financial loss, auth/safety failure,
  or an incompatible deploy with no recovery window.
- **P1**: real but recoverable breakage requiring migration, backfill, drain, coordinated deploy,
  staged rollout, or a costly split/revert.
- **P2**: advisory rollout, rollback-note, migration-churn, or small purity improvement.

Likelihood is the chance the hazard materializes, not how often the code executes. Production state
that is unknown becomes a release check instead of a guessed likelihood.

## Not violations

- Additive, reversible migrations without a concrete hazard.
- A new env var declared for every target with a sane default or loud startup failure.
- Short-TTL cache changes whose readers tolerate a miss.
- Small, verifiable, cheap-to-revert behavior changes without a feature flag.
- Product-authorized prompt behavior changes with proportionate validation and rollout.
- Additive/internal UI work that does not change an established interaction.
- Large but coherent changes that cannot ship independently.
