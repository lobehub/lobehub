# LobeHub Acceptance Mistakes

Project-specific mistakes only. Read this with the agent-testing skill's generic
`references/common-mistakes.md`. Stable ids use the `L-` prefix so they cannot be
confused with the generic `M` catalogue or old numeric field-note ids.

## Evidence and publication

### L-E1 — Publishing a replacement as a second Acceptance row

**Wrong approach:** assign a replacement check a new id without `supersedes`, or
pass a visible UI check from test output / computed styles alone.

**Why it fails:** Acceptance intentionally does not fuzzy-match titles, and
program output does not establish the rendered result.

**Correct approach:** declare the previous stable id in `supersedes`; give every
user-visible case its own opened screenshot and assert the complete spatial
outcome, including overlap.

### L-E2 — Calling a permission change “no UI surface”

**Wrong approach:** publish only router/API transcripts because the diff contains
no TSX.

**Why it fails:** the blocked user's rejection, error feedback, and still-visible
affordances are product behavior.

**Correct approach:** drive the real UI as blocked and allowed roles, capture both
outcomes, and report raw/missing feedback as a UX finding.

### L-E3 — Publishing synthetic displacement as passing layout evidence

**Wrong approach:** apply a large temporary transform to isolate position syncing,
then publish a screenshot while the product panel is visibly displaced.

**Why it fails:** the numeric assertion may pass while the visual evidence depicts
a broken product state and appears to prove the regression.

**Correct approach:** capture the settled result of a real layout transition. Keep
synthetic position probes as text evidence only, and restore the DOM before any
passing screenshot.

## Product and interaction design

### L-D1 — Treating a status badge as the information hierarchy

**Wrong approach:** spend the strongest row position on a large generic “Online”
badge while demoting hostname, platform, and scope; omit the device icon from the
matching tool inspector.

**Why it fails:** repetitive state overwhelms the fields users need to distinguish
devices, and the collapsed tool chain loses identity.

**Correct approach:** put a semantic status dot beside the name, reserve the detail
column for identifying metadata, use the device icon consistently, and verify
expanded plus zero-count states visually.

### L-D2 — Rebuilding a sibling surface from visual impression

**Wrong approach:** copy the sibling's style without enumerating its affordances,
states, wiring, and authored-data conventions.

**Why it fails:** “consistent with” is a feature checklist, not a color-and-spacing
match.

**Correct approach:** walk the canonical implementation feature-by-feature, reuse
its components where possible, and compare both surfaces side by side before
publishing.

### L-D3 — Applying role/scope rules to one bulk action

**Wrong approach:** add own/workspace scope variants to one maintenance action
while leaving sibling actions with different authority semantics.

**Why it fails:** authority was reviewed per menu item rather than as a
role × action × scope matrix.

**Correct approach:** enumerate every matrix cell; keep members own-only and give
owners explicit workspace variants with stronger confirmation for destructive
operations.

## Environment safety

### L-S1 — Acquiring Electron auth through OAuth

**Wrong approach:** click Sign in or call `requestAuthorization` on a dev instance.

**Why it fails:** Electron opens the user's default browser, while per-instance
localhost callback state is commonly unusable.

**Correct approach:** inject auth from the saved Electron login snapshot or a
server-minted dev session. If neither exists, report one manual sign-in as blocked;
never open the flow for the user.

## Historical source

[The original field notes](./references/common-mistakes-field-notes.md) retain the
full incident narratives and old Case numbers for earlier cross-references.
