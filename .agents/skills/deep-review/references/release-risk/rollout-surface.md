# Rollout, Shared-Surface, and PR-Purity Risk

Read this reference when the diff changes a user-visible main path, a shared component or package
API, a first-minute interaction, or several independent requirements.

## Rollback granularity

Recommend a feature flag only when all of these hold:

- the change alters a user-visible main path;
- the bad outcome is silent wrongness rather than an obvious crash;
- production data, traffic, or a third party prevents complete pre-ship validation; and
- reverting the whole PR is disproportionately expensive.

Also recommend a flag for a staged cohort rollout. State the observation that permits removing the
flag and the old path.

Do not recommend a flag for:

- a plain bug fix;
- scripts, dev tooling, agent skills, or other internal-only changes;
- schema changes themselves;
- a surface already covered by an equivalent switch; or
- a change where flag plumbing costs more than reverting it.

## Shared surfaces

Treat files under shared component directories, exported package APIs, hooks, utilities, and
contexts as shared surfaces.

- Count call sites and include the count in the finding.
- Check changed defaults, fallback behavior, event timing, and required/narrowed props.
- Include platform variants and package consumers, not only the current app.
- Multiply added render/effect/subscription cost by call-site count.
- Flag caller-specific branches pushed into a generic shared abstraction; abstraction ownership
  belongs to `reuse-architecture`, while this dimension reports recovery and blast radius.

No measurable blast radius or unchanged existing contract means no release-risk finding.

## First-minute UI

First-minute surfaces include the post-auth entry screen, main work/chat surface, navigation,
sidebar, command palette, and composer.

- Report only changed established behavior: moved/removed controls, altered defaults, new
  confirmation steps, or changed keyboard/submit semantics.
- State what an existing user experiences on the first load after deploy and how quickly the defect
  reaches the user base.
- Purely additive elements, internal refactors, and style fixes are not release-risk findings.
- Design quality belongs to `ux`; this dimension judges reach and recovery.

## PR purity

- Cluster changed files by independent sub-requirement, not by directory.
- Recommend a split only when a cluster is independently buildable/deployable and large or risky
  enough to justify separate review and rollback.
- Mixed-risk drive-by refactors, formatting, dependency bumps, or unrelated copy changes increase
  rollback cost and can be findings.
- Do not report size alone. A requirement that legitimately spans many files is one coherent scope.
- Do not propose a split that creates a broken intermediate state.

Purity findings cap at P1 and normally do not block release unless the bundled part independently
creates a P0 risk.
