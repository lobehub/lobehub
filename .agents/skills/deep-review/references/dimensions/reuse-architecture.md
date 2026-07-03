---
id_prefix: reuse
verify: true
skip_when: pure-deletion or docs-only diff
---

# Reuse & Architecture

Cross-file thinking: does this diff reinvent something the repo already has, ignore an established pattern, or erode an architectural boundary? This is the only dimension whose findings require repo-wide searching — never judge from the diff alone.

## Quick checklist

- New behavior unit (file, exported hook/util/component/selector, ≥ 20-line nameable block) duplicating an existing implementation — check `packages/utils`, `src/utils/`, `src/hooks/`, shared modules
- Hand-rolled logic where a standard pattern exists (ad-hoc type guard, manual `setInterval` + ref cleanup, string-concatenated paths, custom validation) — search before writing
- Copy-pasted blocks with slight variation that should be one shared function
- Parameter sprawl: piling boolean/option flags onto an existing function instead of generalizing or splitting
- Leaky abstraction: exposing internals callers should not depend on, or breaking an existing abstraction boundary
- Bare strings/numbers where the repo already has an enum/constant
- New hand-maintained parallel catalog (menu/tab/config list duplicated across files) — derive from one source; parallel copies drift (the settings category catalog has already lost items this way)
- Business/domain code placed in the wrong layer (page segments under `src/routes/` must stay thin and delegate to `src/features/`)

## Rule sources (deep mode: read before reviewing)

- `.agents/skills/project-overview/SKILL.md` — layer map: what belongs in apps/packages/src
- `.agents/skills/spa-routes/SKILL.md` — roots vs features split
- `.agents/skills/store-data-structures/SKILL.md`, `.agents/skills/zustand/SKILL.md` — store shape and action patterns when the diff touches stores

## How to check

Two passes — outward then inward:

**Outward (dedup + pattern reuse):**

1. List the behavior units this diff introduces.
2. For each, `rg` the repo with action + context keyword combos (e.g. `window.open` + popup, `setInterval` + poll, `JSON.parse` + storage).
3. Default reuse sources to check first: `packages/utils/`, `src/utils/`, `src/hooks/`, `src/lib/`, `*/store/selectors/`, sibling directories of the changed files.
4. Open every hit and compare behavioral equivalence: same input → same output/side effect. Name/parameter differences still count as equivalent; syntactic similarity with different semantics does not.
5. Report only with `existing_implementations` filled (`file:line` or `file:line-range`, ≥ 1 entry).

**Inward (extensibility):** judge the diff's own design — parameter sprawl, leaky abstractions, hardcoded literals with existing constants (`rg` to confirm the constant exists).

Large-repo fallback: if a single `rg` exceeds \~30s, restrict to the changed files' top-level directories plus the default reuse sources.

## Violations

- Diff introduces a new unit with ≥ 1 behaviorally equivalent existing implementation (`nature: "introduced"` even when the existing copy is old — adding the duplicate is new).
- Diff extends a duplication-prone pattern (adds a third hand-maintained copy of a catalog).

## Not violations

- Pre-existing duplication among old files this diff does not touch or extend.
- Repo-wide extensibility musings unrelated to this PR ("the project should have a generic useInterval") — out of scope.
- Deliberate duplication with a stated reason (comment or PR description explains why sharing is wrong here).
