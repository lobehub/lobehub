---
id_prefix: reuse
verify: true
skip_when: pure-deletion or docs-only diff
---

# Reuse & Architecture

Cross-file thinking: does this diff reinvent something the repo already has, ignore an established pattern, or erode an architectural boundary? This is the only dimension whose findings require repo-wide searching — never judge from the diff alone.

Reuse operates at three levels, and AI-authored diffs most often fail at the upper two — they write locally plausible code without checking how the repo already solves this class of problem:

1. **Unit**: a function/hook/component that already exists
2. **Idiom**: an established implementation pattern for this kind of operation (e.g. data fetching rides store SWR hooks + service + `lambdaClient`, never `useEffect` + `useState`)
3. **Cross-layer route**: how a feature of this category threads through the layers (component → store → service → TRPC → repository) — same-kind features follow the same route

## Quick checklist

- New behavior unit (file, exported hook/util/component/selector, ≥ 20-line nameable block) duplicating an existing implementation — check `packages/utils`, `src/utils/`, `src/hooks/`, shared modules
- Hand-rolled logic where a standard pattern exists (ad-hoc type guard, manual `setInterval` + ref cleanup, string-concatenated paths, custom validation) — search before writing
- Idiom deviation: the repo has an established pattern for this operation category but the diff invents its own (fetching server data with `useEffect`/`useState` instead of the store SWR pipeline; hand-rolled modal state instead of `createModal`; component calling `lambdaClient` directly instead of through a service)
- Cross-layer route deviation: a new feature is structured differently from its nearest same-kind sibling — skips a layer, merges layers, or invents new ones — without a stated reason
- Copy-pasted blocks with slight variation that should be one shared function
- Parameter sprawl: piling boolean/option flags onto an existing function instead of generalizing or splitting
- Leaky abstraction: exposing internals callers should not depend on, or breaking an existing abstraction boundary
- Fix placed at the wrong layer of a long pipeline: the layer the fix touches does not match the layer that owns the problem — a variant-specific quirk patched in a shared layer (special-case pollution affecting every other consumer), or a class-wide problem patched in one variant (symptom fix; the same bug stays alive on every other path)
- Bare strings/numbers where the repo already has an enum/constant
- New hand-maintained parallel catalog (menu/tab/config list duplicated across files) — derive from one source; parallel copies drift (the settings category catalog has already lost items this way)
- Business/domain code placed in the wrong layer (page segments under `src/routes/` must stay thin and delegate to `src/features/`)

## Rule sources (deep mode: read before reviewing)

- `.agents/skills/project-overview/SKILL.md` — layer map: what belongs in apps/packages/src
- `.agents/skills/spa-routes/SKILL.md` — roots vs features split
- `.agents/skills/data-fetching-architecture/SKILL.md` — the canonical cross-layer route for server data (component → store SWR hook → service → `lambdaClient`)
- `.agents/skills/store-data-structures/SKILL.md`, `.agents/skills/zustand/SKILL.md` — store shape and action patterns when the diff touches stores
- Category pattern skills when the diff's category has one (`modal`, `trpc-router`, `builtin-tool`, `drizzle`, ...) — check `.agents/skills/` for a skill matching the touched domain; when one exists it is the yardstick, cite it in `rule_source`

## How to check

Three passes — precedent, outward, inward:

**Precedent (pattern alignment) — run this first for any new feature/capability:**

1. Classify what the diff adds (data fetching, store slice, service method, modal, route, builtin tool, DB model, ...).
2. Find the nearest existing same-kind implementation — a sibling directory, a similar store slice, a service doing an analogous job — and read how it flows through the layers.
3. Compare structure, not names: same layering? same naming scheme (`useFetchXxx` / `refreshXxx`)? same failure-handling shape? A structural deviation is a finding unless the diff or PR states why the precedent does not fit.
4. When a category pattern skill exists, prefer it over the oldest code you find — precedents can themselves be legacy.

**Outward (dedup + pattern reuse):**

1. List the behavior units this diff introduces.
2. For each, `rg` the repo with action + context keyword combos (e.g. `window.open` + popup, `setInterval` + poll, `JSON.parse` + storage).
3. Default reuse sources to check first: `packages/utils/`, `src/utils/`, `src/hooks/`, `src/lib/`, `*/store/selectors/`, sibling directories of the changed files.
4. Open every hit and compare behavioral equivalence: same input → same output/side effect. Name/parameter differences still count as equivalent; syntactic similarity with different semantics does not.
5. Report only with `existing_implementations` filled (`file:line` or `file:line-range`, ≥ 1 entry).

**Inward (extensibility):** judge the diff's own design — parameter sprawl, leaky abstractions, hardcoded literals with existing constants (`rg` to confirm the constant exists).

**Fix placement (for bug fixes on long pipelines):** many bugs can be patched at several points of the chain they live on (e.g. user message → agent runtime → provider → render); correct placement is decided by problem ownership, not by where the patch is easiest:

1. Identify the pipeline and list the candidate layers where this fix could live.
2. Ask: is the root cause specific to one variant (one provider, one platform, one client) or common to the whole class?
3. Variant-specific → the fix belongs in the variant's own layer: a DeepSeek parameter quirk goes in `packages/model-runtime/src/providers/deepseek/`, not in the shared `core/openaiCompatibleFactory/` where it would branch for every provider. Class-wide → the fix belongs in the shared layer, not replicated at one call site.
4. Check the shared layer's existing extension points first (factory options, hooks, per-variant config) — the repo usually already provides a seam for variant behavior; adding an `if (variant === ...)` branch to shared code when a seam exists is the violation.

Large-repo fallback: if a single `rg` exceeds \~30s, restrict to the changed files' top-level directories plus the default reuse sources.

## Violations

- Diff introduces a new unit with ≥ 1 behaviorally equivalent existing implementation (`nature: "introduced"` even when the existing copy is old — adding the duplicate is new).
- Diff invents a new implementation route for a category the repo already handles with an established idiom or cross-layer pattern — `existing_implementations` points at the precedent (and cite the category pattern skill when one exists).
- A fix whose layer contradicts the problem's ownership (variant quirk in shared code, or class-wide bug fixed for one variant only) — name the layer that owns the problem and, for shared-layer edits, the existing seam that was bypassed.
- Diff extends a duplication-prone pattern (adds a third hand-maintained copy of a catalog).

## Not violations

- Pre-existing duplication among old files this diff does not touch or extend.
- Repo-wide extensibility musings unrelated to this PR ("the project should have a generic useInterval") — out of scope.
- Deliberate duplication with a stated reason (comment or PR description explains why sharing is wrong here).
- Deviating from a precedent that is itself legacy — when a pattern skill or migration guide marks the newer way, following the skill against old code is correct, not a violation.
- A shared-layer fix for a bug reported against one variant, when the root cause genuinely lives in the shared code (the reporter just happened to be the first variant to hit it) — verify ownership before flagging placement.
