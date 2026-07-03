---
id_prefix: design
verify: true
skip_when: docs/lockfile-only diff
---

# Business Logic Design

Design-level judgment on how the change solves its requirement: does it use the platform as documented, match the solution's weight to the problem, and avoid self-inflicted complexity? Whether the code is _correct_ belongs to the logic dimension; this dimension asks whether it is _well-conceived_.

## Quick checklist

- Framework misuse: fighting Next.js/React/Drizzle instead of using the documented mechanism (check official docs before assuming custom code is needed)
- Self-inflicted complexity ("没苦硬吃"): hand-rolling what the framework, an external dependency, or a simpler design gives for free. "External" is the boundary — duplicating a sibling in-repo implementation belongs to reuse-architecture, not here; report it there or leave it to that reviewer
- Hand-built domain machinery the external platform offers natively: custom implementations of domain mechanisms (usage metering, billing math, invoice generation, subscription lifecycle, scheduling, webhook retry) when the platform the feature runs on — payment provider, auth service, deployment platform — ships the capability built in. Classic failure: hand-rolling usage records + charge calculation + invoices because nobody knew the payment provider has native metered billing. Reviewers share the author's blind spots — check the platform's official docs, don't trust memory
- Solution weight mismatched to requirement scale: a new abstraction layer, config system, or queue where a direct implementation satisfies the stated need — and the inverse, a quick hack on a path the requirement marks critical (billing, auth, data integrity)
- Best-practice violations with a citable source (official docs, a repo skill, `DESIGN.md`) — not personal taste

## Rule sources (deep mode: read before reviewing)

- Framework docs when the diff leans on framework behavior (`node_modules/next/dist/docs/` for Next.js — this repo pins a version with breaking changes; do not trust training data)
- Official docs of the external platform the diff builds on (payment, auth, deployment, messaging) — web-search them when not available locally; the question is always "does this platform already do this natively?"
- The requirement background in the scope summary — the yardstick for solution-weight judgments

## How to check

1. For each non-trivial mechanism the diff introduces, ask "does the framework or an existing dep already provide this?" — check the docs, do not assume.
2. For domain mechanisms, identify the external platform involved and search its official docs for a native solution — "we didn't know it existed" is the most expensive form of self-inflicted complexity, and it survives review when the reviewer relies on the same memory the author did.
3. Compare the solution's weight against the requirement's stated scope and lifespan (a temporary campaign does not need a config system; a billing path does not get a quick hack).
4. For each best-practice finding, name the source you would cite in `rule_source` — no citable source, no finding.

## Violations

- Custom machinery duplicating a documented framework feature or a native capability of the external platform the feature runs on (cite the doc).
- Solution complexity unjustified by the requirement, or robustness shortcuts on paths the requirement marks critical.

## Not violations

- Simple implementations of simple needs (calibration principle — match the codebase's bar, not an idealized one).
- Personal-taste preferences without a citable source.
- Complexity with a stated reason (a comment or the PR explains the constraint that forces it).
