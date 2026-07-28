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

### L-E4 — Claiming an authoring flow from its entry point

**Wrong approach:** publish the “Add check” button and source-level evidence as
proof that manual check creation is complete.

**Why it fails:** an entry point does not demonstrate form entry, the resulting
check, or where the new item enters the acceptance lifecycle.

**Correct approach:** verify the full UI sequence: entry, completed form with
preview, and the created item in its editable pre-verification state. Keep the
manual path independent from rubric loading so an unrelated rubric request cannot
block it.

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

### L-E4 — Trusting a stripped-env `lh` publish to reach production

**Wrong approach:** publish with `env -u LOBEHUB_SERVER … lh acceptance run
ingest`, taking a clean-env `lh whoami` showing the user's real profile as proof
the target is production.

**Why it fails:** `lh login` persists `serverUrl` into `~/.lobehub/settings.json`,
which env-stripping cannot clear, and the local dev DB carries the user's synced
real profile — so the ingest lands in the local DB and the published
`app.lobehub.com/acceptance/<id>` link 404s.

**Correct approach:** discriminate the target with a data probe (query an object
that exists on only one side) or read `settings.json` directly; to publish
without clobbering a localhost login, log in to prod under an isolated
`LOBEHUB_CLI_HOME` and keep that variable set for the ingest.

### L-D4 — Pinning a composer open while leaving its collapse affordance visible

**Wrong approach:** configure a host surface to default its shared composer open,
but continue rendering the shared component's Collapse action.

**Why it fails:** the host promises a permanently available input while the UI
still advertises the opposite state transition; clicking it restores the very
extra step the host-specific design removed.

**Correct approach:** make collapse capability an explicit host option. A pinned
composer hides the Collapse action, while drawer or overlay hosts retain their
existing collapsible behavior; verify both host contracts independently.

### L-D5 — Mapping an annotation to copy without checking control boundaries

**Wrong approach:** infer that a circled footer region refers to “Copy review
prompt” when the region spans adjacent actions, then replace that label with “Fix”.

**Why it fails:** the copy action and the dispatch action have different intent;
changing the wrong control removes useful transport wording while leaving the
requested primary action unchanged.

**Correct approach:** map normalized annotation coordinates onto the actual
screenshot dimensions and inspect every control inside the region. Preserve “Copy
review prompt” and apply “Fix” to “Send back & rerun”; regression-test both labels
together and visually verify their side-by-side rendering.

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

## Task Detail acceptance prototypes must reuse Acceptance semantics

**Wrong approach**: inventing a task-specific status glyph set and a generic card-based detail drawer while only copying the Acceptance data.

**Why it's wrong**: the same check result reads differently across Task Detail and the canonical Acceptance surface, and the extra labeled cards make a compact review workflow feel like a dashboard.

**What it breaks**: reviewers cannot transfer their learned status vocabulary, and opening one check adds visual hierarchy instead of progressively disclosing its evidence and decision.

**Correct approach**: reuse Acceptance's exact check glyph semantics (`Check`, `XCircle`, `HelpCircle`, `MessageSquareX`) and mirror its expanded-check content order: status/title, verifier conclusion, evidence, standing feedback, then review actions.

## Acceptance evidence must be inspectable, not represented by a placeholder

**Wrong approach**: drawing a generic screenshot placeholder and evidence count inside an otherwise interactive check detail.

**Why it's wrong**: the reviewer opens the detail specifically to inspect the proof; a placeholder preserves layout but removes the content that supports the verdict.

**What it breaks**: the detail surface cannot answer whether the check actually passed or failed, and a “view original” affordance has no meaningful target.

**Correct approach**: render a real evidence image inline at a readable size, wire the original-image action, and keep the surrounding text hierarchy identical to the canonical expanded Check Item.

## “Reuse the Acceptance Check Item” means structural parity, not visual inspiration

**Wrong approach**: retaining a custom drawer header and evidence-card footer after the reviewer explicitly asks for the existing Acceptance Check Item UI.

**Why it's wrong**: even if the same facts are present, custom grouping changes scan order and creates a second interaction dialect for the same object.

**What it breaks**: Task Detail and Acceptance no longer feel like two views of the same check, and every later improvement to the canonical row must be translated manually.

**Correct approach**: mirror the canonical expanded row slot-for-slot: verdict glyph, sequence, title, evidence badges, round chip, expanded chevron, verifier narrative, raw evidence, then review actions. Add only the minimal container-level close affordance required by the right panel.

## A real data path is not enough when the review target is the UI at scale

**Wrong approach**: calling a two-item local Acceptance fixture a real UI acceptance because it uses the production data APIs.

**Why it's wrong**: the request is about how a long, mixed-status acceptance reads inside Task Detail. Two rows cannot expose grouping pressure, list density, status scanning, or the relationship between the full list and the right-side detail.

**What it breaks**: the published evidence technically proves the integration but gives the reviewer no meaningful view of the product decision they need to judge.

**Correct approach**: mirror the representative production bundle's item count, titles, state mix, and semantic groups; capture a viewport tall enough to show the complete list, then separately capture an opened failed item while preserving the list context behind it.

## A detail panel must read as a surface, not as a card inside a surface

**Wrong approach**: place the expanded Acceptance Check Item inside an outlined card and preserve compact list-row typography after moving it into a wide right-side panel.

**Why it's wrong**: the extra border creates a redundant container hierarchy, while list-scale type and spacing make a dedicated detail view still feel like a temporarily expanded row.

**What it breaks**: the panel does not gain the visual authority or readable evidence area expected from progressive disclosure, even when its raw width increases.

**Correct approach**: let the detail content occupy the panel directly without an inner border, use a materially wider panel, and scale the title, verdict glyph, narrative, evidence area, and spacing for sustained reading.

## A detail surface must not inherit list-row controls

**Wrong approach**: reuse the canonical Acceptance CheckRow in a detail panel while retaining its collapse chevron, evidence-type badges, round chips, hover-only review icons, and small footer actions.

**Why it's wrong**: those controls help users scan and expand a dense list; inside an already-open detail surface they duplicate context, imply a nonexistent collapse state, and compete with the actual decision.

**What it breaks**: the reviewer cannot immediately identify the primary next action, and the detail panel still behaves like a list row stretched wider rather than a dedicated decision surface.

**Correct approach**: keep the canonical check content and verdict semantics, but make detail mode permanently expanded, remove list-only metadata and collapse affordances, and present full-width large reject/accept actions separated from the evidence content.

## Check-detail status and identity need separate hierarchy levels

**Wrong approach**: keep the verdict glyph as a small leading icon inside the same line as a modestly sized check title.

**Why it's wrong**: a detail surface must establish state before identity, matching the Acceptance page's status-first header. A list-scale title and inline glyph make the open detail feel like another row.

**What it breaks**: the reviewer cannot scan the check state independently, and the title lacks enough hierarchy to anchor the evidence and decision area below.

**Correct approach**: render a dedicated semantic status pill at the top of the detail, then place the check sequence and a materially larger title on their own heading row.

## Prominent detail actions still need calibrated density

**Wrong approach**: respond to weak review actions by maximizing button height and preserving generous padding above both the detail header and decision bar.

**Why it's wrong**: prominence comes from placement, contrast, and primary/secondary hierarchy, not sheer control size. Oversized buttons and stacked top padding waste the detail surface.

**What it breaks**: the panel feels inflated, the evidence and decision area drift apart, and the status header starts too far below the Portal title.

**Correct approach**: keep the two-column decision bar and primary contrast, but use medium 40px actions, a 12px gap, a 16px separator offset, and a compact handoff from the Portal header into the status-first detail header.

## A terminally accepted Acceptance is not a container for a new delivery

**Wrong approach**: publish later, separately scoped implementation work as new rounds on an Acceptance whose delivery has already been accepted.

**Why it's wrong**: an accepted Acceptance is the closed audit record for one delivery. A new branch or materially new delivery needs its own subject and decision boundary, even when it evolves the same product area.

**What it breaks**: the closed record acquires post-decision evidence, the round history no longer matches the delivery that was accepted, and reviewers cannot independently accept or reject the new work.

**Correct approach**: before every ingest, inspect `acceptance.status` and the latest run decision. If the Acceptance is terminally accepted and the current work is a new delivery, create a new production Task (or use the new work's existing subject) and ingest there. Reuse an accepted Acceptance only when the user explicitly requests reopening that exact delivery and the product supports that lifecycle.

## Single-file edit summaries need stable information hierarchy

**Wrong approach**: place line deltas at the far edge of the card and keep the secondary “View changes” action permanently visible beneath the file title.

**Why it's wrong**: the line delta describes the edited file and belongs with its identity, while an always-visible inspection action competes with the summary during normal conversation scanning.

**What it breaks**: the direct summary no longer matches the compact coding-agent pattern the user expects, and the action occupies persistent visual weight despite being needed only on inspection.

**Correct approach**: place additions/deletions directly below the single-file title, reveal “View changes” on row hover or keyboard focus, and keep it visible while the diff is open so the reverse action remains discoverable.

## Task Acceptance continuity must be proven with one Task

**Wrong approach**: compare the configured criteria of one Task with the completed Acceptance of another Task, then treat a larger cross-round union as a current-data defect.

**Why it's wrong**: two Tasks can legitimately have different goals and item counts, while Acceptance intentionally retains checks introduced by later rounds as part of the auditable delivery history.

**What it breaks**: evidence appears to show an unexplained 6→7 mutation and two different goals, and a legitimate seventh cross-round check can be incorrectly hidden.

**Correct approach**: capture definition and result states from the same Task, keep the full Acceptance check union visible, and keep the Task verify requirement synchronized with the aggregate goal.

# Floating composer overlays must reserve space in every content path

- Wrong approach: reserve the measured composer overlay height only in the virtualized message list.
- Why it fails: an empty conversation renders the welcome surface instead, so alerts and trays can overlap its content.
- What it breaks: combined Alert + tray states visually collide with welcome copy even though the overlay items do not overlap each other.
- Correct approach: apply the same measured overlay reservation to both message and welcome paths, and capture acceptance evidence with the real combined state visible.

## Acceptance evidence must show the requested product container and scale boundary

**Wrong approach:** Proving a Task run from the standalone topic page, or proving checklist grouping only with a small checklist.

**Why it's wrong:** The same content can render in several containers, while the feature under review is the Task's Topic Run drawer. Checklist hierarchy also deliberately changes at the 10-item boundary, so an eight-item sample cannot prove the grouped state.

**What it breaks:** Reviewers cannot inspect the actual drawer composition, per-check expansion behavior, or the flat-versus-grouped threshold.

**Correct approach:** Capture the run by opening the Topic card from Task detail and keeping the Topic Run drawer visible. For checklist UI, capture both sides of the boundary (10 or fewer stays flat; more than 10 groups), open representative checks in each state, and confirm obsolete edit/group controls are absent where they should be.

## Never verify Acceptance UI against an unfetched canary ref

**Wrong approach:** Rebase against a stale local `canary` pointer, start the app, and treat its rendered Acceptance UI as the latest canary behavior.

**Why it's wrong:** The local branch label can lag the remote by many commits; Acceptance presentation changes may already be merged upstream while the working branch still renders the retired UI.

**What it breaks:** Every screenshot in the round proves the wrong product version, so even otherwise-correct interactions and evidence must be discarded.

**Correct approach:** Run `git fetch origin canary`, record the resolved `origin/canary` SHA, verify it is an ancestor of the test branch after rebase, and only then start the dev server and capture evidence.

## Case: Teardown before asynchronous verification and repair reach a terminal state

**Wrong approach:** Publish a report and stop the dev server or QStash as soon as the main agent operation is done or the first verification snapshot looks stuck.

**Why:** Verification runs fire-and-forget after the main operation. Agent verifiers may take several minutes, and auto-repair starts only after every required result becomes terminal. A repair operation and its next verify round can therefore begin well after the main operation reports `done`.

**What it breaks:** Stopping the environment can strand a live repair round in `running` or `pending`, produce a stale report, and make a working auto-repair trigger look absent.

**Correct approach:** Monitor the verify run, all required result rows, repair-operation links, and the bound task until they reach a stable terminal state. Keep the dev server, QStash, Redis, and object storage alive throughout that interval; teardown only after the final repair/verify round settles or a concrete non-progress failure is proven.

## Case: A verification summary does not replace per-check detail evidence

**Wrong approach:** Publish only a checklist summary or a text transcript saying that all checks passed, while omitting screenshots of each expanded check result.

**Why:** Reviewers need to inspect the actual judgment for every delivery criterion, especially when the plan mixes LLM-only checks with image-aware or Agent multimodal checks.

**What it breaks:** The report proves the aggregate count but not what each verifier saw or why each item passed, so the reviewer must request another evidence round.

**Correct approach:** Capture one readable checklist overview plus one expanded-detail screenshot per underlying delivery check. Name evidence by criterion and verifier type, visually inspect every screenshot before attaching it, and include a text mapping from each stable criterion id to its verifier and verdict.

## Case: Evidence attachments do not replace the requested product artifact

**Wrong approach:** Upload a complete generated document only as Acceptance evidence and assume that satisfies a requirement to deliver the document from the Task.

**Why:** Acceptance evidence explains why a check passed; it is not the Task's durable deliverable surface. Reviewers looking for the output in the Task workspace will not find an evidence-only file.

**What it breaks:** The content may be technically present in the audit record while the actual Task has no pinned document artifact for users to open, reuse, or continue editing.

**Correct approach:** Create the generated content as a real product document, pin it to the owning Task, and attach separate Acceptance evidence proving both the document content and its Task association.

## Case: Screenshot requirements must disclose multimodal verification

**Wrong approach:** Show only a generic `LLM` or `Agent` badge beside a screenshot evidence requirement, with verifier metadata and required media split across separate rows.

**Why:** A screenshot cannot be judged by a text-only model, and separating the labels makes the relationship between verifier capability and evidence medium ambiguous.

**What it breaks:** Reviewers cannot tell whether the visual evidence was actually inspected by a multimodal model, and the metadata block consumes unnecessary vertical space.

**Correct approach:** Keep verifier type, multimodal capability, and required evidence media in one compact row; whenever screenshot evidence is required, explicitly label the verifier as using a multimodal LLM.

## Case: Master-detail pages must assign scrolling to bounded panes

**Wrong approach:** Let a long outline and detail body determine the page height, then rely on a sticky outline or a shared outer `overflow: auto` container.

**Why:** A master-detail workspace is one stable task surface. When intermediate flex children keep their default `min-height: auto`, content expands the frame and silently transfers scroll ownership to the whole document. Direct flex children can also shrink to hide the missing inner scrollbar.

**What it breaks:** The outline header disappears, the selected item and detail context drift together, compact layouts become one long page, and independent navigation/detail reading is impossible.

**Correct approach:** Constrain every ancestor in the height chain with `flex: 1`, `height: 100%`, and `min-height: 0`; keep the frame overflow hidden; give the outline list and detail body separate `overflow-y: auto` regions; prevent list rows from shrinking; and verify via DOM measurements that both document scroll positions remain zero while each pane scrolls independently.

## Trusting CDP port 9222 without verifying which app owns it

- **Wrong approach**: attach `agent-browser --cdp 9222` and evaluate DOM/state assuming it is the LobeHub dev Electron.
- **Why**: 9222 is a universal default; other projects' dev Electrons (e.g. unrelated repos) claim it first. A user-started LobeHub dev instance often has NO `--remote-debugging-port` at all.
- **What it breaks**: all collected evidence (DOM, localStorage, console) silently describes a different product.
- **Correct approach**: before any eval, verify identity — check the process command line (`ps ax | rg Electron` → path must be under this repo) and probe the renderer (e.g. script srcs / a known global). If the user's instance has no CDP, start a pool instance (`electron-dev.sh start <n>`, distinct port) instead of guessing; note a user-started instance may die when the pool instance boots (observed once, causality unverified) — warn the user first.