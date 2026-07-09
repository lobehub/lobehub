---
id_prefix: compat
verify: true
skip_when: no UI theming/routing, no API contract, no deployment config, no data-scoping/permission logic, no runtime-branching code touched
---

# Compatibility

The same change must work across every surface this product ships to. Authors (and reviewers) habitually validate only their own dev setup — typically **cloud edition + web desktop + light mode + latest client + personal workspace** — and every other cell of the matrix is where regressions hide.

## The compatibility matrix

| Axis           | Variants to hold in mind                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Theme          | light / dark (`cssVar.*` tokens handle both; hardcoded colors break one)                                            |
| Platform       | desktop app (Electron) / web desktop / web mobile / React Native                                                    |
| Client version | released desktop/mobile clients keep calling old endpoints after the server deploys                                 |
| Agent runtime  | client-side runtime vs server runtime (gateway enabled or not)                                                      |
| Deployment     | Vercel (serverless: no local fs persistence, execution time limits) vs Docker (long-lived process)                  |
| Edition        | open-source self-hosted (business slots return safe no-op defaults) vs cloud (commercial overrides active)          |
| Tenancy        | personal context (`workspaceId === null`) vs workspace context (workspace-scoped data, permissions, member sharing) |

## Quick checklist

- Hardcoded colors or light-only assets — break dark mode; use theme tokens
- New route/page registered in `src/spa/router/desktopRouter.config.tsx` but not `desktopRouter.config.desktop.tsx` (or vice versa) — causes blank screens; `desktopRouter.sync.test.tsx` must stay green
- Mobile variant missing: page/feature added to desktop routes with no `(mobile)` counterpart or responsive handling
- Deleted/renamed TRPC procedure or webapi route still called by released clients — keep a compatibility alias; for deprecated write paths a side-effect-free noop is acceptable **only when** the old client treats that success shape as "nothing to do" and no user-visible state, billing, permission, or deletion is falsely reported complete; for meaningful operations return a stable business error (`PRECONDITION_FAILED` / `410 Gone`) instead of blind success
- Changed API input/output shape without versioning or optional-field fallback for older callers
- Logic assuming the agent runtime location (client vs server/gateway) — must branch or stay runtime-agnostic
- Serverless-hostile code: local file writes, in-memory state expected to survive requests, long-running work beyond function limits
- Workspace-blind logic: new data reads/writes, permission checks, or list scoping that silently assume the personal context — must respect the active workspace scope (`useActiveWorkspaceId` / `workspaceSlug`) or be explicitly personal-only by design
- Cloud-only assumption: logic that only works when a business slot has its cloud override — must still function against the slot's open-source no-op default (feature hidden or gracefully degraded, not broken)
- Renamed backend route paths (`src/app/(backend)/webapi/...`) or SSR page paths (`src/app/[variants]/(auth)/...`), or changed `@lobechat/business-*` exports — downstream deployments override/extend these paths; flag so they can adapt
- Dependency major bumps (`next`, `drizzle-orm`, ...) — downstream lockstep required; call out in the PR description

## Rule sources (deep mode: read before reviewing)

- `.agents/skills/spa-routes/SKILL.md` — router pair invariant, mobile/desktop variants
- `.agents/skills/react/SKILL.md` — theming/token rules
- Git history of the old endpoint (`git log -p` on the deleted route) before trusting that a procedure is unused — inspect what removed the caller and whether released clients predate it

## How to check

1. For each removed/renamed export, route, or procedure: search current code for callers, then check whether a _released_ client (desktop/mobile/RN) could still call it — current-code absence is not proof.
2. For UI changes: read the styles for hardcoded colors; check both router configs when routes change; look for the mobile counterpart.
3. For server changes: scan for fs writes, timers, in-memory caches that assume process longevity.
4. For data/permission logic: trace what happens when `workspaceId` is `null` (personal / self-hosted) and when the involved business slots return their open-source defaults — both paths must stay sound.

## Violations

- Any matrix axis where the change demonstrably breaks or silently degrades, introduced by this diff.

## Not violations

- Axes the changed surface genuinely cannot reach (a server-only refactor does not need a dark-mode check).
- Breaking changes explicitly coordinated in the PR description (migration window, paired client release) — verify the coordination is stated, then leave a note-level finding at most.
