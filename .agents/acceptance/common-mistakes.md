# LobeHub Acceptance Mistakes

Project-specific mistakes only. Read this with the agent-testing skill's generic
`references/common-mistakes.md`. Stable ids use the `L-` prefix so they cannot be
confused with the generic `M` catalogue.

Keep this file at the level of durable LobeHub product and environment invariants.
Exact copy, pixel values, component slot order, and one-off review directions belong
in feature specifications or historical field notes, not in this living checklist.

## Evidence and publication

### L-E1 — Publishing a replacement as a second Acceptance row

**Wrong approach:** assign a replacement check a new id without `supersedes`, or
pass a visible UI check from test output or computed styles alone.

**Why it fails:** Acceptance intentionally does not fuzzy-match titles, and program
output does not establish the rendered result.

**Correct approach:** declare the previous stable id in `supersedes`; give every
user-visible case opened visual evidence and assert the complete spatial outcome,
including overlap.

### L-E2 — Publishing synthetic displacement as passing layout evidence

**Wrong approach:** apply a temporary transform to isolate position syncing, then
publish a screenshot while the product panel is visibly displaced.

**Why it fails:** the numeric assertion may pass while the visual evidence depicts a
broken product state.

**Correct approach:** capture the settled result of a real layout transition. Keep
synthetic probes as supporting text evidence and restore the DOM before capturing a
passing screenshot.

### L-E3 — Claiming an authoring flow from its entry point

**Wrong approach:** publish an entry button and source-level evidence as proof that
manual check creation is complete.

**Why it fails:** an entry point does not demonstrate form entry, the resulting
check, or where it enters the Acceptance lifecycle.

**Correct approach:** verify entry, completed input and preview, and the created item
in its editable pre-verification state. Keep this path independent from unrelated
rubric loading.

### L-E4 — Verifying the wrong product container or scale boundary

**Wrong approach:** prove behavior in a standalone or harness surface when the
requested surface is a Task drawer, or use a small fixture for behavior that changes
at a list-size threshold.

**Why it fails:** the same content composes differently across containers, and small
fixtures cannot expose grouping, density, overflow, or master-detail pressure.

**Correct approach:** capture the requested product container with representative
titles, state mix, item count, and both sides of every behavior-changing threshold.
Use harnesses only as supporting evidence.

### L-E5 — Replacing per-check evidence with a verification summary

**Wrong approach:** publish only an aggregate checklist or transcript saying that all
checks passed.

**Why it fails:** reviewers cannot inspect what each verifier saw or why each
delivery criterion passed.

**Correct approach:** capture a readable overview and inspectable detail evidence for
each underlying criterion. Map every stable criterion id to its verifier, evidence,
and verdict.

### L-E6 — Treating Acceptance evidence as the requested product artifact

**Wrong approach:** upload a generated document only as Acceptance evidence when the
Task requires a durable document deliverable.

**Why it fails:** audit evidence explains a verdict; it does not create a reusable
artifact in the Task workspace.

**Correct approach:** create and pin the real product artifact to the Task, then
attach separate evidence proving its content and association.

### L-E7 — Hiding multimodal requirements in split verifier metadata

**Wrong approach:** label a screenshot check only as `LLM` or `Agent`, with media
requirements and model capability shown elsewhere.

**Why it fails:** reviewers cannot tell whether the visual evidence was actually
inspected by a multimodal model.

**Correct approach:** present verifier type, multimodal capability, and required
evidence media together; explicitly identify screenshot checks as multimodal.

### L-E8 — Proving Task continuity with different Tasks

**Wrong approach:** compare criteria from one Task with results from another and
interpret the different item counts as a lifecycle defect.

**Why it fails:** Tasks may legitimately have different goals, while Acceptance
retains later-round checks as delivery history.

**Correct approach:** capture definition and result states from the same Task, keep
the complete cross-round check union visible, and synchronize the Task verification
requirement with the aggregate goal.

### L-E9 — Appending a new delivery to a terminally accepted Acceptance

**Wrong approach:** publish separately scoped implementation work as a new round on
an Acceptance whose delivery has already been accepted.

**Why it fails:** the closed audit record no longer matches the delivery that was
decided, and reviewers cannot independently accept or reject the new work.

**Correct approach:** inspect Acceptance status before ingest. Create a new Task or
subject for a materially new delivery; reopen the existing delivery only when the
user explicitly requests it and the lifecycle supports it.

### L-E10 — Judging agent quality without proving the runtime model

**Wrong approach:** trust the model shown before Agent assignment, then judge the run
without checking the persisted Task configuration and completed message metadata.

**Why it fails:** Agent assignment can replace the Task provider or model, so the
observed behavior may belong to a fallback model.

**Correct approach:** after every assignment or Task edit, verify both persisted
provider/model configuration and the first completed assistant message metadata.
Attach the runtime identity to the Acceptance round before judging quality.

### L-E11 — Declaring an ingest done without reconciling its evidence count

**Wrong approach:** read `acceptance run ingest`'s success JSON, see an
`acceptanceId` and a round index, and stop — treating a `[WARN] evidence upload
failed, skipping <file>` line above it as noise because the command still exited 0.

**Why it fails:** a transient storage error skips exactly one artifact and the run
publishes anyway. When the casualty is one half of a `comparison` pair, the
surviving half renders alone under its role band — a lone `before` screenshot reads
as "the fix never landed", inverting the round's verdict.

**Correct approach:** count the evidence items in `result.json` before publishing
and compare against the ingest JSON's `evidence` field; treat any WARN line as a
failure of the publish step. Do not retro-attach the missing file with
`acceptance run evidence upload` — that path carries no `comparison` metadata, so
the image lands unpaired and unlabeled. Publish a fresh round carrying the complete
evidence set instead, and say in `report.md` that it re-publishes the same
observations rather than re-running the cases.

### L-E12 — Expressing multimodal disclosure through the `verifier` enum

**Wrong approach:** write a value such as `"verifier": "multimodal LLM"` in a plan
item to satisfy the requirement that screenshot checks disclose multimodal review.

**Why it fails:** `verifier` is a closed set (`program` / `agent` / `llm`) that the
ingest validator rejects outside those values, so the whole payload fails. The
disclosure is not expressible in that field.

**Correct approach:** set `"verifier": "llm"` and carry the multimodal disclosure in
the plan item's `method` prose alongside `"requiredEvidence": ["screenshot"]`.

## Product and interaction contracts

### L-D1 — Rebuilding a canonical surface from visual impression

**Wrong approach:** copy a sibling surface's appearance without enumerating its
semantics, states, affordances, wiring, and authored-data conventions.

**Why it fails:** visual similarity can hide a second interaction dialect for the
same product object and causes later improvements to drift.

**Correct approach:** inspect the canonical implementation feature by feature, reuse
its semantic components where possible, and compare both surfaces side by side.

### L-D2 — Applying role and scope rules to only one bulk action

**Wrong approach:** add own/workspace scope variants to one maintenance action while
leaving sibling actions with different authority semantics.

**Why it fails:** authority was reviewed per menu item instead of as a role × action
× scope matrix.

**Correct approach:** enumerate every matrix cell; keep members own-only and give
owners explicit workspace variants with stronger confirmation for destructive work.

### L-D3 — Exposing a disabled host capability

**Wrong approach:** configure a host to keep a shared composer permanently open while
continuing to render the component's Collapse action.

**Why it fails:** the host contract and the advertised state transition contradict
each other.

**Correct approach:** model collapse capability as an explicit host option. Verify
pinned and collapsible hosts independently.

### L-D4 — Stretching a list row into a detail surface

**Wrong approach:** reuse dense list-row chrome and controls unchanged inside an
already-open detail panel.

**Why it fails:** list affordances such as expansion controls and compact metadata
duplicate context and compete with the detail surface's reading and decision tasks.

**Correct approach:** preserve canonical object semantics and evidence order, but
give detail mode its own permanently expanded interaction contract and clear decision
hierarchy. Keep exact layout values in the feature specification.

### L-D5 — Reserving floating-composer space in only one content path

**Wrong approach:** reserve the measured composer overlay height in the virtualized
message list but not in the empty or welcome path.

**Why it fails:** alerts and trays can overlap welcome content even though overlay
items do not overlap each other.

**Correct approach:** apply the same measured reservation to every content path and
capture the real combined overlay state.

### L-D6 — Giving a master-detail page ambiguous scroll ownership

**Wrong approach:** let long outline and detail content expand the document, or rely
on one shared outer scroll container.

**Why it fails:** navigation and reading context drift together, headers disappear,
and intermediate flex sizing can hide the intended inner scrollbars.

**Correct approach:** bound the workspace, keep the frame overflow hidden, assign
independent scroll regions to navigation and detail, and verify scroll ownership with
DOM measurements as well as visual evidence.

## Environment safety

### L-S1 — Publishing to an assumed server target

**Wrong approach:** strip a server environment variable and treat `lh whoami` as
proof that Acceptance ingest targets production.

**Why it fails:** `lh login` persists `serverUrl` in the CLI settings, and a local
database may contain the user's synchronized profile.

**Correct approach:** inspect the effective CLI settings or use a data probe that
distinguishes environments. For production publishing without changing a local
login, use an isolated `LOBEHUB_CLI_HOME` for login and ingest.

### L-S2 — Trusting a successful renderer build as proof Electron boots

**Wrong approach:** use green Vite and Vitest results as blank-screen insurance for
a desktop routing or module-graph change.

**Why it fails:** browser ESM initialization cycles and nested-router invariants can
fail only when the real renderer starts.

**Correct approach:** boot the real Electron instance, require the project readiness
probe to report a non-error UI, and inspect a screenshot. Router-host component tests
must also cover the real outer-router composition.

### L-S3 — Verifying Acceptance UI against an unfetched canary ref

**Wrong approach:** rebase against a stale local `canary` pointer and treat its UI as
the latest canary behavior.

**Why it fails:** already-merged presentation changes may make every screenshot prove
the retired product version.

**Correct approach:** fetch `origin canary`, record the resolved SHA, and verify it is
an ancestor of the test branch before starting the evidence environment.

### L-S4 — Tearing down before asynchronous verification settles

**Wrong approach:** stop the dev server or workflow dependencies when the main agent
operation finishes or the first verification snapshot appears stuck.

**Why it fails:** verification and repair can start minutes later and may still own
pending operations.

**Correct approach:** monitor verification results, repair-operation links, and the
bound Task until a stable terminal state. Keep every required dependency alive until
the final round settles or a concrete non-progress failure is proven.

### L-S5 — Trusting CDP port 9222 without verifying its owner

**Wrong approach:** attach to port 9222 and assume it belongs to the LobeHub dev
Electron instance.

**Why it fails:** another Electron project can own the universal default port, while
the user's LobeHub instance may expose no debugging port at all.

**Correct approach:** verify the owning process path and probe a LobeHub-specific
renderer marker before collecting evidence. If needed, start an isolated pool
instance on a distinct port rather than guessing.

### L-S6 — Reading or writing the url from a portal'd sidebar on desktop

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

## Historical source

Detailed incident narratives and retired pixel- or component-specific directions
belong in [the field notes](./references/common-mistakes-field-notes.md), where they
remain available without becoming mandatory rules for every Acceptance run.
