# Common Mistakes Field Notes — historical detail

> Historical project-layer source material. The maintained catalogue is
> `../common-mistakes.md`. Append there using its stable `L-` identifiers.
>
> This file previously served as the writable project layer. Its entries use
> Wrong approach / Why it's wrong / What it breaks / Correct approach. The
> generic, product-independent mistake catalogue lives in the
> installed skill's `references/common-mistakes.md` (read-only in this repo,
> updated by PR to `@lobehub/cli`) — read BOTH layers before a run. When an entry
> here turns out to be product-independent, genericize it (drop the LobeHub
> nouns) and PR it upstream.
>
> Most of the historically accumulated cases were promoted to the generic layer;
> what remains here is the LobeHub-platform-specific residue (the verify /
> Acceptance page mechanics, permission-surface framing). Cases keep their
> original numbers so older cross-references still resolve; a reference to a case
> not in this file now lives in the generic layer.

---

## Case 26 — Treating a device list status badge as a substitute for information hierarchy

**Wrong approach**: rendering a remote-device row with a large generic “Online” badge in the
right-hand detail position while placing hostname, platform, and scope in a low-emphasis second
line below the device name; omitting the device icon from the corresponding tool Inspector.

**Why it's wrong**: online state is a compact property of the device identity, while hostname,
platform, and scope are the details users need to distinguish similar machines. Giving the status
the entire right edge reverses that hierarchy. The icon omission also makes the collapsed tool
call harder to scan, and mixed text-component line heights can visibly misalign the Inspector
count.

**What it breaks**: device rows waste their strongest metadata area on repetitive state, similar
devices become harder to compare, and the collapsed tool chain looks visually unfinished.

**Correct approach**: put a platform-neutral device icon in the list Inspector; align count text
with an explicit shared line box; place a semantic status dot plus localized status beside the
device name; reserve the right-hand column for hostname, platform, and scope. Verify both expanded
rows and the zero-count Inspector in a real chat screenshot.

---

## Case 25 — Building a surface's "twin" without walking the sibling implementation feature-by-feature

**Wrong approach**: when asked to make surface B "consistent with" an existing surface A (a list
panel, an evidence renderer, a link chip), skimming A for its visual language (colors, spacing,
component choices) and rebuilding B from that impression — instead of walking A's implementation
feature-by-feature and porting each one deliberately. In one round this dropped: A's search box,
A's before/after comparison rendering, and A's authored-report field conventions (title / verdict /
comparison labels), while a hover state contradicted the intended text-emphasis semantics.

**Why it's wrong**: "consistency" is a checklist over the sibling's FEATURES, not a style match.
Every capability the sibling has that the twin lacks is a bug the user will find one screenshot
later. The ux skill's own line — "compose the canonical surface component, don't re-derive it" —
covers exactly this, but it only bites if the sibling is actually enumerated before building.

**What it breaks**: the user gets a surface that looks 90% right and is missing load-bearing
features; a round of "为什么这里缺 X / 丢了 Y" feedback that a 10-minute sibling walk would have
prevented; trust that "对齐" means aligned.

**Correct approach**: before building a twin surface, enumerate the sibling's implementation —
grep its component for every rendered affordance (search, empty states, comparison views, hover
behaviors, drawer wiring) and its data conventions (which fields the author must supply) — and
turn that list into the build checklist. After building, diff the two surfaces side by side in
screenshots before publishing. For authored artifacts (result.json), re-read the field spec in
the report reference instead of writing from memory: `title` and `summary.verdict` are identity
fields, and comparison pairs need per-side `label`s.

---

## Case 20 (a) — Publishing a replacement as a second Acceptance row and passing UI from text-only evidence

**Wrong approach**: giving a refined check a new id without declaring `supersedes`, then marking
visual UI checks passed from unit-test output or computed-style text without capturing and opening a
screenshot of each claimed surface. A layout probe also accepted an absolutely positioned sidebar
because it was right-aligned, without checking whether it covered the report.

**Why it's wrong**: the Acceptance union intentionally does no fuzzy title matching; without an explicit
replacement edge, both ids are valid independent requirements. Program output proves logic, not the
rendered Markdown entity or the absence of visual overlap. A single CSS property is not the layout
contract.

**What it breaks**: superseded wording remains as a duplicate row, UI changes have no inspectable proof,
and a green report can visibly cover its own content.

**Correct approach**: when a new check replaces an older semantic requirement, put the prior stable id in
the new plan item's `supersedes` array. Every user-visible UI case must require its own screenshot, open
that image before passing, and assert the complete spatial outcome (right attachment plus zero overlap),
not an isolated computed-style value. Never reuse one screenshot as evidence for unrelated UI cases.

---

## Case 20 (b) — Calling a server-side permission change "no UI surface" and shipping an API-transcript-only report

> The generic layer covers the broad rule (a UI-touching change needs visual evidence); this entry
> keeps the LobeHub-specific framing of an authorization/permission change as a UI surface. Candidate
> to genericize + upstream if it stops being LobeHub-specific.

**Wrong approach**: for a change that only edits TRPC routers (tightening who may
mutate a shared resource), classifying the run as backend-only and publishing a
verify report whose evidence is exclusively curl/API probe transcripts. The user
opened the report and asked "完全没有截图吗？".

**Why it's wrong**: a permission tightening IS a UI-visible state — the blocked
user still sees the edit/delete affordances and now gets a rejection (error toast /
failed action) when clicking them. "The diff touches no .tsx file" does not mean
"no UI surface"; the UI surface is the product behavior the change alters, not the
files it edits.

**What it breaks**: the report cannot show what a real blocked user experiences
(is the rejection surfaced comprehensibly? silently swallowed? a raw error?), and
it misses UX follow-ups the screenshot would expose (e.g. affordances that should
be hidden/disabled for users who will always be rejected).

**Correct approach**: for any authorization/permission change, drive the REAL UI
as the blocked role and screenshot the rejection state (and the allowed role's
success state) in addition to API probes. If the rejection renders as a raw or
missing error message, report that as a finding instead of leaving it undiscovered.

---

## Case 26 — Applying dual scope to only one bulk-maintenance action

**Wrong approach**: introduce own-scope and workspace-scope variants for one
bulk action while leaving sibling maintenance actions owner-own-only.

**Why it is wrong**: authority was evaluated per menu entry rather than across
the complete role × action × scope matrix.

**Correct approach**: enumerate every matrix cell. Members receive own-only
actions; owners receive both own and workspace variants for each applicable
action, with elevated confirmation for destructive workspace-wide operations.

## Never acquire Electron auth through the OAuth flow — inject state instead

**Wrong approach**: on a signed-out desktop instance, following the old auth.md
recipe — evaluating `remoteServerService.requestAuthorization(...)` (or clicking
the app's "Sign in") to "drive the sign-in yourself".

**Why it's wrong**: `AuthCtr` implements that flow with `shell.openExternal`, so
every attempt **pops a login/authorize page in the user's default browser** —
visibly, on their machine, repeatedly when retried. Dev instances also sit on
per-instance ports (`localhost:3024`, …), so the authorize URL targets a localhost
origin whose session/callback usually cannot complete: the user just accumulates
broken login tabs.

**What it breaks**: hijacks the user's personal browser session, leaks test
activity into their real browsing context, and erodes trust in automated runs.

**Correct approach**: login state is injected, never interactively acquired —
① restore the `electron-login` snapshot (`login-status` / `save-login`);
② mint the session via CLI/API seeding (the `web-seed` philosophy); ③ otherwise
report auth as ❌ Blocked and request ONE manual sign-in. The corrected policy
lives in `references/auth.md` ("When the instance comes up signed out") and
PROJECT.md §4 Electron.
