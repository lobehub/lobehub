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

---

## Retired from the checklist — 2026-09-03

Removed from `../common-mistakes.md` when the catalogue moved to the checklist + `holds-while` shape. Kept verbatim; a future run that hits one of these again promotes it back with a `holds-while` it can name.

### Enforced by code since — the tool now reports it

#### L-E11b — Publishing a new round onto a check the reviewer already accepted

**Wrong approach:** when new feedback arrives about a check the user has already
accepted, reuse that check's id for the new work — because reusing ids is the rule for
rejected checks.

**Why it fails:** an accepted verdict is deliberately sticky (`acceptanceService`
computes `stale` only for rejects, and a test pins that behaviour by name). A later
result on a settled id therefore inherits the tick: the round publishes green and the
reviewer is never told there is anything new to look at. Since 2026-08, `attachRun`
refuses such a round outright — the error names the offending ids and nothing is
written, so a partially attached round cannot happen.

**Correct approach:** read `userReview.action` before writing the plan. `accept` means
settled: the new work needs a NEW check id, which appears unreviewed and can actually
be judged. Reuse the id only while the check is rejected or never reviewed. Decide by
_is the criterion new, and has the old one been accepted_ — not by how big the change
is: a presentation fix on a still-open check reuses its id (\[\[L-E1]]), while a newly
raised criterion on an accepted check must not.

#### L-E12 — Expressing multimodal disclosure through the `verifier` enum

**Wrong approach:** write a value such as `"verifier": "multimodal LLM"` in a plan
item to satisfy the requirement that screenshot checks disclose multimodal review.

**Why it fails:** `verifier` is a closed set (`program` / `agent` / `llm`) that the
ingest validator rejects outside those values, so the whole payload fails. The
disclosure is not expressible in that field.

**Correct approach:** set `"verifier": "llm"` and carry the multimodal disclosure in
the plan item's `method` prose alongside `"requiredEvidence": ["screenshot"]`.

### Feature-spec facts — belong in the feature spec or a regression test

#### L-E7 — Hiding multimodal requirements in split verifier metadata

**Wrong approach:** label a screenshot check only as `LLM` or `Agent`, with media
requirements and model capability shown elsewhere.

**Why it fails:** reviewers cannot tell whether the visual evidence was actually
inspected by a multimodal model.

**Correct approach:** present verifier type, multimodal capability, and required
evidence media together; explicitly identify screenshot checks as multimodal.

#### L-E8 — Proving Task continuity with different Tasks

**Wrong approach:** compare criteria from one Task with results from another and
interpret the different item counts as a lifecycle defect.

**Why it fails:** Tasks may legitimately have different goals, while Acceptance
retains later-round checks as delivery history.

**Correct approach:** capture definition and result states from the same Task, keep
the complete cross-round check union visible, and synchronize the Task verification
requirement with the aggregate goal.

#### L-E14 — Verifying an insertion affordance without continuing the user's next action

**Wrong approach:** check that a composer affordance (an action-tag chip, a mention,
a file token) inserted the right node, screenshot it, and move on — then verify the
sent payload through a _different_ entry point that happens to be easier to drive.

**Why it fails:** insertion is half the affordance; the caret it leaves behind is
the other half. A caret parked in front of the inserted node sends the user's very
next keystroke to the wrong side of it. For any chip that serializes into the prompt
with position semantics — the `/goal` marker must lead the message for `isGoalPrompt`
to match — that silently rewrites the payload into something the runtime no longer
recognizes, while every screenshot of the insertion itself still looks correct.
Verifying the payload through a different entry point hides it completely: the path
with the defect is never the path that gets sent.

**Correct approach:** for every insertion affordance, continue the user's action in
the same case — type after inserting — and assert the resulting node order, not just
the node's presence. Drive the payload check through the _same_ entry point the case
under test uses; if an affordance has several entries (slash menu, `+` menu), the one
you send from must be the one you are claiming works. Assert order in the persisted
`editor_data`, since that is what both the prompt serializer and the bubble read.

#### L-E18 — Concluding a composer surface is dead code because nothing imports it

**Wrong approach:** after changing a component the ActionBar reuses (a skill row, for
instance), grep for a default import of `ActionBar/Tools`, find no hit, conclude the
surface is not mounted, and verify only the `+` menu path.

**Why it fails:** ActionBar surfaces are not mounted by a direct import. They are
enabled by an action-key registry plus each route's own `leftActions` array.
`ActionBar/config` registers `tools: Tools` at all times; what actually decides
whether it renders is `leftActions` in `src/routes/(main)/**/MainChatInput` — the
group-chat composer enables `'tools'` and reaches the component through
`PopoverContent → ToolsList`, a different composition path from the `+` menu. Missing
it makes a green verification cover only half of what users can see.

**Correct approach:** after changing any component the ActionBar reuses, enumerate
where the action key is actually enabled (grep each route's `leftActions` array, not
the component's imports) and capture evidence for every surface that enables it. Mark
any surface you deliberately skip as untested.

#### L-D2 — Applying role and scope rules to only one bulk action

**Wrong approach:** add own/workspace scope variants to one maintenance action while
leaving sibling actions with different authority semantics.

**Why it fails:** authority was reviewed per menu item instead of as a role × action
× scope matrix.

**Correct approach:** enumerate every matrix cell; keep members own-only and give
owners explicit workspace variants with stronger confirmation for destructive work.

#### L-D3 — Exposing a disabled host capability

**Wrong approach:** configure a host to keep a shared composer permanently open while
continuing to render the component's Collapse action.

**Why it fails:** the host contract and the advertised state transition contradict
each other.

**Correct approach:** model collapse capability as an explicit host option. Verify
pinned and collapsible hosts independently.

#### L-D4 — Stretching a list row into a detail surface

**Wrong approach:** reuse dense list-row chrome and controls unchanged inside an
already-open detail panel.

**Why it fails:** list affordances such as expansion controls and compact metadata
duplicate context and compete with the detail surface's reading and decision tasks.

**Correct approach:** preserve canonical object semantics and evidence order, but
give detail mode its own permanently expanded interaction contract and clear decision
hierarchy. Keep exact layout values in the feature specification.

#### L-D5 — Reserving floating-composer space in only one content path

**Wrong approach:** reserve the measured composer overlay height in the virtualized
message list but not in the empty or welcome path.

**Why it fails:** alerts and trays can overlap welcome content even though overlay
items do not overlap each other.

**Correct approach:** apply the same measured reservation to every content path and
capture the real combined overlay state.

#### L-D8 — Rendering a cross-agent dispatch envelope as a visible user turn

**Wrong approach:** treat every persisted `role: user` row as a user-authored
message when building the visible conversation list.

**Why it fails:** `callAgent` persists a synthetic user envelope beneath the
caller assistant so the target Agent has an isolated execution context. When
that envelope is rendered, the original prompt appears twice even though the
target Agent produced only one reply.

Users see a duplicate prompt bubble and cannot tell whether
the delegation ran once or twice; acceptance screenshots become misleading.

**Correct approach:** stamp synthetic envelopes with explicit dispatch metadata
when they are persisted, keep them in the context tree, and let the presentation
layer hide only rows declared `visibility: internal`. Continue traversal through
the envelope so the target assistant reply remains independently visible.
Never infer authorship from agent-id differences or a parent tool call: a real
cross-Agent user follow-up can have the same tree shape.

#### L-D9 — A Project conversation must preserve Project identity across routing and history

**Wrong approach:** implement Project chat by navigating users to the Project coordinator's
ordinary `/agent/:agentId/:topicId` surface and present that Agent's topic list as the Project
history.

**Why it fails:** the coordinator is an implementation detail. Leaving the Project route changes
the visible owner and navigation contract, so users reasonably read the conversation as belonging
to an Agent rather than to the Project that provides its tasks, goals, resources, and history.

**Correct approach:** keep creation, topic selection, and resumed conversations under the Project
route and Project sidebar. The coordinator may still execute the conversation internally, but the
visible URL, active list, empty state, and navigation must consistently identify the Project.

#### L-S11 — Bundled SPA HTML is not the whole site

**Wrong approach:** collect only tags and CSS `url()` from `index.html`, then treat
a Vite/webpack `dist` as publishable.

**Why it fails:** hashed images and public sprites live in the JS bundle
(`new URL('hero-….png', import.meta.url)`, `href: '/icons.svg#…'`). HTML-only
collection ships CSS/JS and drops the files the app actually paints. Those JS
references also cannot be inlined as data URIs: `import.meta.url` and SVG
`<use href="/icons.svg#id">` need real sibling/root files.

**Correct approach:** walk collected JS the same way as CSS. Keep
`import.meta.url` targets and root-absolute sprites as sidecars even when they
are under the inline size limit. Judge a Vite publish by the running page
(images, icons, counter), not by whether `index.html` listed three tags.

#### L-S12 — macOS `/tmp` and `/private/tmp` are the same workspace

**Wrong approach:** treat a Files-tree path and the topic working directory as
outside each other when one string starts with `/tmp` and the other with
`/private/tmp`.

**Why it fails:** Darwin's `/tmp` is a symlink to `/private/tmp`. Electron's
project index reports the real path; topic cwd is often the public alias. A
prefix check then marks `./app.css` as an escape, HTML-only publish keeps the
relative hrefs, and the live host 404s those files.

**Correct approach:** canonicalize those Darwin private aliases before workspace
containment. Prove a publish by fetching the public HTML (data URIs or 200
sidecars) and opening the live page — in-app preview of the local file does not
prove the hosted assets.

### Design or tooling knowledge — belongs to another skill (modal / react / ux / spa-routes) or the dependency docs

#### L-D1 — Rebuilding a canonical surface from visual impression

**Wrong approach:** copy a sibling surface's appearance without enumerating its
semantics, states, affordances, wiring, and authored-data conventions.

**Why it fails:** visual similarity can hide a second interaction dialect for the
same product object and causes later improvements to drift.

**Correct approach:** inspect the canonical implementation feature by feature, reuse
its semantic components where possible, and compare both surfaces side by side.

#### L-D10 — Long `confirmModal` bodies overlay the footer

**Wrong approach:** put a long list into `confirmModal({ content })` and assume the
library pins Cancel / OK below a scroll area.

**Why it fails:** `confirmModal` renders `ConfirmBody` (content + footer) inside
`ModalContent`, which is itself `overflow: auto`. A tall list makes the dialog
scroll as one column, or the footer paints over the last rows. Callers cannot pass
content styles to change that.

**Correct approach:** for any confirm body that can exceed a few lines, use
`createModal` with a height-capped `ScrollArea` as `content` and put the actions in
the modal `footer` slot. Assert `footer.top === scroller.bottom` at both ends of the
list, not just that the dialog opened.

#### L-D13 — Picking `cssVar` color-scale steps by antd-palette intuition

**Wrong approach:** choose antd-style palette steps (`cssVar.blue1` for a tint,
`cssVar.blue6` for the primary line) from the standard antd 10-step palette in
your head, and judge the result from the code alone.

**Why it fails:** LobeHub's theme overrides the color scales with an 11-step
palette whose primary-strength band sits at x9–x10 — light-mode `blue-6`
resolves to `#acd4ff` and `blue-7` to `#93c8ff`, both near-pastel, nothing like
antd's `blue-6` `#1677ff`. The UI then renders washed out while every token
name in the code reads correct, and a one-step "fix" (x1→x2, x6→x7) changes
almost nothing.

**Correct approach:** never pick a scale step without reading the resolved
value in the running app (`getComputedStyle` on the element, or resolve
`--ant-<color>-<n>` from the element's scope — the variables are scoped, not on
`:root`). For a tinted-tile + line pairing, the working band is around x3 for
the tint and x9–x10 for the line, verified in both themes: the scale flips in
dark mode, so a step that is a tint in light is a deep fill in dark.

## Environment safety

#### L-S6 — Reading or writing the url from a portal'd sidebar on desktop

**Wrong approach:** use `useSearchParams`, `useQueryState`, `useParams`,
`useLocation`, `useNavigate`, or a bare `<Link>` inside a component that a route
layout registers through `NavPanelPortal`, and verify it only on web.

**Why it fails:** the desktop shell renders every registered sidebar outside the
per-tab routers, so React context binds those hooks to the root router, whose
location never moves. A write lands on a router no page reads and a read resolves
the boot url. Both are silent: the sidebar renders normally and web is unaffected,
so the defect looks like unrelated page logic. Verified twice in this catalogue's
lifetime — as a topic-switch failure that made the generation page ignore its own
send button, and as a library tree that never expanded to the open folder.

**Correct approach:** in any shell-rendered tree, read through the active-tab
facades (`useActiveLocation`, `useActiveRouteParams`) and navigate through
`useWorkspaceAwareNavigate` / `appNavigate`, keeping `<Link>` only for its href
with the click handled by the facade. Note that no active-tab twin exists for
search params: express a param write as a facade navigation rather than
`setSearchParams`. When the state is a url ⇄ store sync owned by the page, mount
it in the route layout instead, and cover it with a test that asserts which router
received the write — a test that only asserts a write happened passes on the
broken topology too.

#### L-S0 — Concluding a dependency moved from the root manifest alone

**Wrong approach:** refresh a shared dependency by running `pnpm install --filter .`
at the repo root — or by bumping only the root range and running a full install —
then read the new version out of `package.json` and treat a type-check failure in
untouched files as pre-existing.

**Why it fails:** the filter installs only the root workspace, and even an unfiltered
install leaves `packages/*` on their old resolution when they declare a loose range
(`"@lobehub/ui": "^5"` is satisfied by both the old and the new version, so nothing
forces them to move). Two identities of the same package then coexist in the graph,
and the errors surface far from the change — a duplicated `next` shows up as
`NextRequest is not assignable to NextRequest` in backend route shells, and a
duplicated UI package kills routes at the ErrorBoundary with a missing React context,
or gives a component library two copies of a shared z-index/portal manager. Neither
names the real cause.

**Correct approach:** run a full `pnpm install` (no filter) after any dependency
range change, then `pnpm dedupe` when the root and the workspace packages resolve
different versions of a shared peer. State the version only from resolved copies —
count the versions under `node_modules/<pkg>` and every `packages/*/node_modules/<pkg>`
and require one distinct value — never from the root manifest. Remember `apps/desktop`
and `apps/cli` are standalone installs that a root install never covers.

#### L-S15 — Trusting a lockfile-false workspace's node\_modules to track current specs

**Wrong approach:** debug a "missing export" build failure in a workspace with
`lockfile: false` by bumping package.json specs or running `pnpm up`, assuming the
next install re-resolves.

**Why it fails:** pnpm keeps a hidden `node_modules/.pnpm/lock.yaml` that freezes
prior resolutions even with `lockfile: false`; `pnpm install` and `pnpm up` can
report success while every symlink stays on the stale version. CI never hits this
because it installs from scratch.

**Correct approach:** when installed versions contradict fresh-resolution
expectations, delete the hidden `node_modules/.pnpm/lock.yaml` (or the whole
node\_modules) in the affected workspace root and reinstall, then re-verify the
actual resolved version via the importing package's symlink.

### Moved to PROCESS.md as rules that hold under pressure (narrative kept here)

#### L-S4 — Tearing down before asynchronous verification settles

**Wrong approach:** stop the dev server or workflow dependencies when the main agent
operation finishes or the first verification snapshot appears stuck.

**Why it fails:** verification and repair can start minutes later and may still own
pending operations.

**Correct approach:** monitor verification results, repair-operation links, and the
bound Task until a stable terminal state. Keep every required dependency alive until
the final round settles or a concrete non-progress failure is proven.

#### L-S10 — Judging popover/menu behaviour from a Chrome MCP tab (it is hidden)

**Wrong approach:** drive the debug-proxy page through the Chrome MCP tools, click a
popover trigger, read the DOM \~500ms later, see no popup, and conclude the trigger is
broken — then bisect, revert a refactor, and write up a root cause from those readings.

**Why it fails:** the MCP tab is not the foreground tab. Measured inside it:
`document.visibilityState === 'hidden'`, `requestAnimationFrame` delivers **0 frames**,
and `setInterval(16ms)` fires **once per second** (Chrome's background throttling). A
base-ui popup still opens in its store and mounts in the DOM, but its entry transition
never advances, so it sits at `data-starting-style` with `visibility: hidden` and zero
size — indistinguishable from "the click did nothing". Anything else timed from that
tab (perceived latency, "it landed 7 seconds later") is an artifact of the same
throttling, not of the code under test.

**Correct approach:** in an MCP tab, assert on **state**, not on visibility — the
component's own store/props (`handle.store.state.open`, a probed React state), or DOM
presence with `data-open`, never `visibility`/painted pixels or a rAF-timed measurement.
Confirm the tab's own health first (`visibilityState`, a rAF frame count) before
trusting any negative UI observation, and get behaviour that depends on animation or
input timing confirmed in a foreground tab — the user's window, or a screenshot-based
check that tolerates a frozen transition. A negative result from a hidden tab is not
evidence of a defect.

#### L-S13 — Treating a workspace another session has rewritten as your own code

**Wrong approach:** edit and verify in place in this repo, and when the screenshots
stop matching the source, suspect the Vite cache or your own CSS — restarting the
dev server, adding more changes, and capturing again.

**Why it fails:** a second session can be working on the same worktree. Its rebase
helper stashes the **entire working tree** (stash message shaped like
`pre-rebase2-<pr>-<sha>`), rebases the branch, and pops later; a conflicted pop
leaves `<<<<<<<` markers inside the other session's files and breaks the whole SPA
build. Both phases point away from the real cause: first "my change is written but
has no effect" (the file was actually reverted to its HEAD version), then "the app
will not open" (a conflict marker in someone else's file). Either one sends you
debugging code you never broke.

**Correct approach:** confirm your change is still on the tree both before and after
capturing evidence — the file appears in `git status` and a marker unique to your
change greps. On a mismatch, read `git stash list` timestamps and `git reflog`
before suspecting the build cache. When your work has been stashed, recover only
your own file with `git checkout stash@{n} -- <your file>`; **never pop or drop the
whole stash** — it belongs to the other session, and popping it is that session's
own action. When you find conflict markers in someone else's file, wait for them to
resolve it rather than resolving it for them.

#### L-S18 — Calling a fix verified without reproducing the failure's precondition

**What happened.** A "draft stays in the composer after the task is created"
bug was declared fixed across four separate rounds (r5 / r7 / r8 / r9) and was
still fully present. Each verification ran against a task list that _already had
tasks in it_, and the bug only exists on the empty→non-empty transition — that
transition is what swaps the composer for a different component instance. Every
"fix" ran green on a page where the failure could not occur.

Two false root causes were shipped on the way: a stale editor handle (the handle
is `useMemo(..., [])`, it was never stale) and a Lexical update landing outside
the React event batch. Both were reasoned by analogy to other call sites rather
than measured.

**Rule.** Before verifying a fix, first reproduce the failure and write down the
precondition that makes it appear. Then verify with that precondition held. A
verification run that cannot fail proves nothing, and a green result on it is
worse than no result — it retires the bug from the todo list.

**Tell.** The bug reproduces "sometimes" or "only on the first try". That is not
flakiness; it is an unnamed precondition. Find it before touching the code.

**Tell.** The unit tests pass and the real app still breaks. Check what the test
mocks: here `cleanDocument` was `vi.fn()`, so the tests asserted the call was
made and could never observe that it landed on a dead instance. When the mocked
seam _is_ the suspect, drop the mock and drive the real thing — a 20-line probe
with the real editor kernel settled in one run what four rounds of analogy had
not.
