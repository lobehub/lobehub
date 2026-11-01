---
id_prefix: ux
verify: true
skip_when: no user-facing surface changed (components, styles, copy, interaction flows)
---

# UX

Design-level review of user-facing flows, judged against this product's design values — Natural / Meaningful / Certainty / Growth (自然 / 意义感 / 确定性 / 成长) — not generic taste.

## Quick checklist

- Empty state: first-run and zero-data views designed, not a blank area
- Loading state: async surfaces show skeleton/spinner/optimistic feedback — no dead frames
- Error state: failures tell the user what happened and what to do next; no silent swallow, no raw error codes
- Async feedback: mutations confirm success/failure (toast, inline state); long operations show progress
- Destructive/irreversible actions gated by confirmation that names the consequence
- Button hierarchy: one primary action per surface; destructive actions not styled as primary
- Lists at scale: 1000-item behavior considered (virtualization, pagination, search)
- Copy: user-facing text is clear, i18n'd, and consistent with existing terminology
- Interaction details: focus management, keyboard path (Enter/Escape), disabled-with-reason over silently inert

## Rule sources (deep mode: read before reviewing)

- `DESIGN.md` (repo root) — the four design values; judge flows against them explicitly
- `.agents/skills/ux/SKILL.md` — product design principles and per-pattern checklists

## How to check

1. Identify every user-visible state the diff introduces or alters; enumerate empty/loading/error/success for each.
2. Walk the flow as a first-time user: what do they see before data arrives, on failure, after success?
3. Compare copy and interaction patterns with the closest existing feature — divergence needs a reason.

## Violations

- A reachable user state with no designed presentation (blank, stuck, unexplained failure).
- A flow contradicting a design value or an established interaction pattern in the app (cite the sibling feature).

## Not violations

- Visual choices within the established design system used consistently (taste disagreements are not findings).
- Missing delight/polish on flows equivalent to the codebase's current bar (calibration principle) — polish suggestions are P2 advisories at most.
- States unreachable by real interaction (verify reachability before reporting).
