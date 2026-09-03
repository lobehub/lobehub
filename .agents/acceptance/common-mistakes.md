# LobeHub Acceptance Mistakes

Project-specific mistakes only. Read this with the acceptance skill's generic
`references/common-mistakes.md`; stable ids use the `L-` prefix so they cannot be
confused with the generic `M` catalogue. The generic file's "How this file is
injected" applies here unchanged: **read the Checklist in full** once the target
is known and again before marking any case `pass`; pull an **entry by id** only
when its line applies (`rg -n '^### L-' <file>`, then `sed -n`).

Only judgment rules live here. Every entry carries `since` and `holds-while` —
the mechanism it depends on. When that mechanism moves into a script default or
an ingest check, the entry is deleted the same day (admission and exit rules:
[PROCESS.md](./PROCESS.md) Step 0). Rules an agent skips under pressure are in
PROCESS.md, not here. Incident narratives, feature-spec facts, and retired
entries live in [the field notes](./references/common-mistakes-field-notes.md).

Categories and id prefixes: `L-E*` evidence and publication, `L-D*` product and
interaction contracts, `L-S*` environment safety. Append inside the category with
the next free number of that prefix.

## Checklist

**Evidence and publication**

- **L-E1** A replacing check declares `supersedes`; a visible-UI check passes only on opened visual evidence asserting the full spatial outcome, overlap included.
- **L-E2** A passing layout screenshot shows the settled real transition — never a DOM under a synthetic transform.
- **L-E3** An authoring flow is proven end to end: entry, completed input and preview, the created item in its pre-verification state.
- **L-E4** Verify in the requested product container at representative scale, on both sides of every behavior-changing threshold; a harness is supporting evidence only.
- **L-E5** Every criterion maps to its verifier, its own inspectable evidence, and a verdict — never an aggregate "all passed".
- **L-E6** When the Task requires a durable document, create and pin the real artifact; evidence explains a verdict, it is not the deliverable.
- **L-E9** Check the acceptance's status before ingest; new scoped work on an accepted acceptance goes to a new subject.
- **L-E10** After any Agent assignment or Task edit, verify the persisted provider/model and the first completed message's metadata before judging quality.
- **L-E11** Reconcile the evidence count in `result.json` against the ingest JSON; any `[WARN] evidence upload failed` is a failed publish — republish a fresh round.
- **L-E13** Uncommitted work on a branch that owns a PR: decide provenance explicitly (open the real PR, or say in `report.md` there is none) and re-read `branch`/`commit` at publish time.
- **L-E14** After an insertion affordance, continue the user's action in the same case and assert node order in persisted `editor_data`; send the payload through the same entry point.
- **L-E15** A conversation-branch regression is verified by sending the next message through the real composer: DB row, parent on the active spine, render before and after cold reload.
- **L-E16** Streaming is proven by timestamped intermediate samples and a GIF whose frames progress — a terminal reply after exit proves persistence only.
- **L-E17** Direct-mention routing is verified with a real tool call and the full persisted tree; no owner assistant, `callAgent`, or synthetic target-user row.
- **L-E19** Markdown evidence: one paragraph per physical line; newline only where it is content.
- **L-E20** Build fixtures through the same composition the product uses; compare an entity page against a canary-created sibling before publishing it as evidence.
- **L-E21** Publish against production even when the subject exists only locally; a local ingest may supplement, never replace.

**Product and interaction contracts**

- **L-D6** Master-detail scroll ownership is asserted with DOM measurements (bounded frame, independent regions), not only visually.
- **L-D7** Verify the deepest route of every section; a route-driven Segmented's active segment is inert, so deep routes need their own ancestor affordance.
- **L-D11** A data-height popover is measured with its trigger at the bottom of the list: `rect.bottom` vs `innerHeight`, non-negative overflow is a defect.
- **L-D12** Every menu entry you add is clicked and its effect asserted; "menu closed, nothing happened" is the failure signature.

**Environment safety**

- **L-S1** Prove the ingest target from effective CLI settings or an environment-distinguishing probe, never from `lh whoami` alone.
- **L-S2** Green Vite/Vitest/lint/tsc is not boot insurance: boot the real surface and read `agent-browser console` on an ErrorBoundary.
- **L-S3** Fetch `origin canary`, record the SHA, and confirm it is an ancestor of the branch before starting the evidence environment.
- **L-S5** Before driving CDP 9222 or a pool port, prove who owns it: Electron `Browser` string on `/json/version`, a LobeHub renderer marker, and _your_ worktree's absolute source path.
- **L-S7** Before capturing evidence for a dependency or module-graph change, prove the served bundle carries it, or restart Vite; compare the running port with `test-env.sh`'s resolved `PORT`.
- **L-S8** A first-boot renderer `Cannot access 'X' before initialization` is reloaded once and re-probed before it is attributed to the change.
- **L-S9** After `migrate`, assert the tables exist; on the shared Postgres, never reset — create a per-run database and export `DATABASE_URL`.
- **L-S14** An image property (alpha, aspect, no text) is asserted from the decoded bytes, never from the prompt that asked for it.
- **L-S16** Every long-run health probe has connect and total timeouts; a listening socket is not health.
- **L-S17** Empty reads plus failing writes: check `select id from users` in the DB the running server uses before debugging the feature.
- **L-S19** `plan[]` holds only what the user accepts or rejects, each id fulfilled by a case; a clean ingest prints `plan: N item(s)` with nothing after it.
- **L-S20** Read the managed containers' host ports from `docker ps` and pass `DB_PORT`/`REDIS_PORT` to every `init-dev-env.sh` subcommand; `auth_failed` on migrate is a port mismatch.
- **L-S21** In a worktree, invoke scripts by absolute path and prove the SPA's identity (Vite pid cwd, changed module from the Vite origin) before trusting any gate or evidence.

## Entries

### L-E1 — Publishing a replacement as a second Acceptance row

`since 2026-07-24` · `holds-while: Acceptance does not fuzzy-match check titles`

**Trap:** a replacement check gets a new id without `supersedes`, or a visible UI
check passes from test output or computed styles alone.

**Rule:** declare the previous stable id in `supersedes`; give every user-visible
case opened visual evidence and assert the complete spatial outcome, overlap
included.

### L-E2 — Publishing synthetic displacement as passing layout evidence

`since 2026-07-24` · `holds-while: always`

**Trap:** a temporary transform isolates position syncing and the screenshot
ships with the panel visibly displaced; the numeric assertion passes while the
image depicts a broken product.

**Rule:** capture the settled result of a real layout transition. Synthetic
probes stay as supporting text; restore the DOM before any passing screenshot.

### L-E3 — Claiming an authoring flow from its entry point

`since 2026-07-24` · `holds-while: always`

**Trap:** an entry button plus source-level evidence is published as proof that
manual check creation works.

**Rule:** verify entry, completed input and preview, and the created item in its
editable pre-verification state, independent of unrelated rubric loading.

### L-E4 — Verifying the wrong container or scale boundary

`since 2026-07-24` · `holds-while: always`

**Trap:** behavior is proven in a standalone harness when the requested surface
is a Task drawer, or with a small fixture for behavior that changes at a
list-size threshold.

**Rule:** capture the requested container with representative titles, state mix
and item count, on both sides of every threshold. Harnesses are supporting
evidence only.

### L-E5 — Replacing per-check evidence with a verification summary

`since 2026-07-30` · `holds-while: ingest accepts a pass/fail case with no evidence`

**Trap:** an aggregate checklist or transcript saying everything passed.

**Rule:** a readable overview plus inspectable detail evidence per criterion; map
every stable id to its verifier, evidence, and verdict.

### L-E6 — Treating Acceptance evidence as the requested product artifact

`since 2026-07-30` · `holds-while: always`

**Trap:** a generated document is uploaded only as evidence when the Task
requires a durable document deliverable.

**Rule:** create and pin the real artifact to the Task; attach separate evidence
proving its content and association.

### L-E9 — Appending a new delivery to a terminally accepted Acceptance

`since 2026-07-30` · `holds-while: ingest does not refuse a round on an accepted acceptance`

**Trap:** separately scoped work is published as a new round on an acceptance
whose delivery was already accepted, so the closed audit record no longer matches
what was decided.

**Rule:** inspect the acceptance status before ingest. New Task or subject for a
materially new delivery; reopen only on explicit user request.

### L-E10 — Judging agent quality without proving the runtime model

`since 2026-07-30` · `holds-while: always`

**Trap:** trusting the model shown before Agent assignment; assignment can
replace the Task provider or model, so the observed behavior belongs to a
fallback.

**Rule:** after every assignment or Task edit, verify the persisted
provider/model and the first completed assistant message metadata; attach the
runtime identity to the round.

### L-E11 — Declaring an ingest done without reconciling its evidence count

`since 2026-07-31` · `holds-while: ingest exits 0 after "[WARN] evidence upload failed, skipping <file>"`

**Trap:** the success JSON shows an `acceptanceId` and a round index, the WARN
above it is read as noise. One skipped half of a `comparison` pair renders alone
— a lone `before` reads as "the fix never landed".

**Rule:** count evidence items in `result.json` against the ingest JSON's
`evidence` field; any WARN is a failed publish. Do not retro-attach with
`acceptance run evidence upload` (no `comparison` metadata → unpaired). Publish
a fresh round with the complete set and say in `report.md` that it republishes
the same observations.

### L-E13 — Publishing uncommitted work onto the branch's unrelated PR

`since 2026-08-10` · `holds-while: ingest resolves the PR from branch when pullRequest is absent OR null`

**Trap:** working-tree changes with no PR are ingested on a long-lived branch
that owns one; every round is stamped with that PR and re-ingesting reproduces
it.

**Rule:** decide provenance before publishing — commit and open the real PR, or
state in `report.md` that this round has no PR and any PR shown belongs to other
work. Re-read `branch` / `commit` at publish time; `report-init.sh` fills them
from whatever was checked out when it ran.

### L-E14 — Verifying an insertion affordance without the user's next action

`since 2026-08-10` · `holds-while: always`

**Trap:** a composer chip/mention/token is checked for presence, screenshotted,
and the sent payload is verified through a different, easier entry point. The
caret parked on the wrong side of the node sends the next keystroke to the wrong
place, and the entry point with the defect is never the one that sends.

**Rule:** continue the user's action in the same case — type after inserting —
and assert node order in the persisted `editor_data`. Send the payload through
the same entry point the case claims to verify.

### L-E15 — Treating historical branch rendering as proof that conversation continues

`since 2026-08-10` · `holds-while: always`

**Trap:** a recovered `taskCallback` card beside the active continuation is
called a verified message-loss fix without sending another user message.

**Rule:** continue from the fixture through the real composer; assert the new
user row in the DB, its parent on the active spine, its rendering before and
after a cold reload, and the assistant continuation when the environment allows.

### L-E16 — Treating a terminal reply as evidence of live streaming

`since 2026-08-10` · `holds-while: lh hetero exec runs Claude Code without --include-partial-messages`

**Trap:** a one-token marker recorded until process exit; the UI shows an empty
target-Agent shell for the whole run and acquires text only at reconciliation,
and the GIF of that shell is mistaken for streaming.

**Rule:** enable partial messages on the device/sandbox spawn path. Verify with a
multi-part response and timestamped DOM/store samples before any reload, then a
GIF whose frames visibly progress to the complete answer. Check persistence
separately, after the live assertion passed.

### L-E17 — Proving direct-mention routing with a text-only response

`since 2026-08-10` · `holds-while: always`

**Trap:** a leading single-Agent mention verified with plain text; tool-capable
runs add tool-call chunks and tool results that can inherit the owner Agent,
create a synthetic target-user envelope, or resume the owner afterwards.

**Rule:** exercise a deterministic real tool call through the same route and
assert the complete persisted tree — owner user, target assistant/tool call,
tool result, target final response — with no owner assistant, `callAgent`, or
synthetic target-user row.

### L-E19 — Hard-wrapping the prose inside a markdown evidence document

`since 2026-08-29` · `holds-while: the evidence renderer parses markdown in chat mode with remark-breaks`

**Trap:** a `markdown`/`text` artifact folded at \~80 columns; every newline
becomes `<br>` and paragraphs break mid-sentence next to a report body that
reflows.

**Rule:** one paragraph per physical line, blank line between blocks; spend a
newline only on list items, table rows, fenced code, and literal transcripts.
Never run a proseWrap formatter over `assets/`.

### L-E20 — Seeding an entity below its composing layer, then publishing its page as evidence

`since 2026-09-03` · `holds-while: goal/task services accept decomposed inputs without a server-side guard re-deriving the composed field`

**Trap:** a goal/task fixture created by calling the service or TRPC endpoint with
minimal fields skips the client-side composer (`buildGoalRequirement` folding
acceptance criteria into the requirement prose); the page renders the
under-composed data faithfully and the reviewer reads it as a regression in an
untouched block.

**Rule:** drive fixtures through the real creation surface or the same shaping
helpers the callers invoke; before publishing an entity page, compare its
populated fields against a canary-created sibling. Prefer a server-side guard so
no API caller can create the under-composed shape.

### L-E21 — Publishing locally because the subject exists only locally

`since 2026-09-03` · `holds-while: always`

**Trap:** the primary report is ingested into a local instance because its Task
or Topic is absent from production; the link dies with the environment.

**Rule:** create a production Task or Topic as the anchor and publish in a clean
environment against `app.lobehub.com`. A local ingest may supplement, never
replace.

### L-D6 — Giving a master-detail page ambiguous scroll ownership

`since 2026-07-30` · `holds-while: always`

**Trap:** long outline and detail content expand the document or share one outer
scroll container; headers disappear and intermediate flex sizing hides the
intended inner scrollbars.

**Rule:** bound the workspace, keep the frame overflow hidden, give navigation and
detail independent scroll regions, and verify ownership with DOM measurements as
well as screenshots.

### L-D7 — Passing a section on its index route only

`since 2026-08-07` · `holds-while: always`

**Trap:** a route-driven `Segmented` switches sibling sections perfectly, so the
index-route pass is taken as coverage; on a nested `:param` route the active
segment is still highlighted and dispatches nothing (`onChange` fires only on
change), so the way back is silently inert.

**Rule:** verify the deepest route of every section. Whenever a section owns
deeper routes, require a separate ancestor affordance (the breadcrumb's section
link) and drive it.

### L-D11 — Trusting a popover to flip itself away from the viewport edge

`since 2026-08-21` · `holds-while: popovers rendered into the app portal container do not side-flip; collisionPadding has no effect`

**Trap:** a hover card anchored to a full-width row is screenshotted from a top
row; from a bottom row it keeps `data-side="bottom"` and extends past the
viewport, and the part that fell off is the part you cannot see.

**Rule:** with the trigger at the **bottom** of its list, assert
`getBoundingClientRect().bottom` against `window.innerHeight`; non-negative
overflow is a defect however the screenshot reads. Bound content by the
positioner's `--available-height` rather than relying on flipping.

### L-D12 — Assuming a menu dispatches an item because it rendered

`since 2026-08-31` · `holds-while: the dropdown group wrapper attaches onClick to top-level items only`

**Trap:** a nested menu entry renders in the right place and does nothing on
click — the menu closes, no error, no toast, and any `keyPath` routing on the
parent never runs.

**Rule:** click every entry you add and assert its effect (dialog, request, store
field). Treat "closed and nothing happened" as the expected failure signature;
for a nested entry verify the child's own dispatch wiring.

### L-D14 — Linking to an agent document with the Work's binding id

`since 2026-09-05` · `holds-while: document Works carry no url and agentDocumentId names the binding row`

**Trap:** `work_versions.metadata.agentDocumentId` is the `agent_documents`
binding ROW id, not the document id the route resolves (`works.resource_id`,
`docs_xxx`); the mis-addressed link degrades silently to the documents index
instead of erroring, so click and navigation both look successful.

**Rule:** address an agent document by `works.resourceId`, using
`metadata.agentDocumentId` only as the binding gate. Verify any Work-to-resource
link in the running app by reading `location.pathname` and `document.title` — a
landing on a list page is the tell.

### L-S1 — Publishing to an assumed server target

`since 2026-07-24` · `holds-while: lh whoami does not print the effective serverUrl`

**Trap:** stripping a server env var and taking `lh whoami` as proof the ingest
targets production; `lh login` persists `serverUrl` in CLI settings and a local
DB may hold the synchronized profile.

**Rule:** inspect the effective CLI settings or run a data probe that
distinguishes environments. For production publishing without touching a local
login, use an isolated `LOBEHUB_CLI_HOME`.

### L-S2 — Trusting green gates as proof the app boots

`since 2026-07-29` · `holds-while: always`

**Trap:** Vite, Vitest, lint and tsc are green after a routing or module-graph
change, and the real renderer dies at the `ErrorBoundary` with
`Cannot access '<X>' before initialization` — Vitest resolves the graph in a
different order than the bundler.

**Rule:** boot the real surface, require the readiness probe to report a
non-error UI, inspect a screenshot. On a boot failure read `agent-browser
console` (the ErrorBoundary page shows no stack) before diagnosing. Keep
cross-module constants in the folder's leaf module; router-host component tests
cover the real outer-router composition.

### L-S3 — Verifying against an unfetched canary ref

`since 2026-07-30` · `holds-while: PROCESS.md Step 2 does not fetch canary itself`

**Trap:** rebasing onto a stale local `canary` and screenshotting the retired
product version.

**Rule:** fetch `origin canary`, record the resolved SHA, and verify it is an
ancestor of the test branch before starting the evidence environment.

### L-S5 — Driving a CDP port without proving its owner

`since 2026-07-30` · `holds-while: electron-dev.sh start treats any reachable CDP port as "already running", and app-probe checks a product-level marker only`

**Trap**, three shapes: 9222 belongs to another Electron project; it is LobeHub
but a sibling worktree's instance (the first `electron-dev.sh` started owns
9222/5173, and a product marker passes for every worktree); or the pool port is
owned by a different debugger — `wrangler`/`workerd` defaults to 9229, which is
pool id 7, and `electron-dev.sh start <id>` skips the launch with
`CDP already reachable`.

**Rule:** before collecting evidence, require all three: an Electron `Browser`
string on `/json/version` (a `wrangler/*` or `node` answer → pick another id),
a LobeHub renderer marker, and _your_ worktree's absolute source path plus a
marker unique to the change:

```bash
agent-browser --cdp 9222 eval "(async()=>{const t=await (await fetch('app://renderer/<repo-relative>.tsx')).text();return t.match(/_jsxFileName = \"[^\"]*\"/)[0]+' '+t.includes('<CHANGE_MARKER>')})()"
```

A wrong-worktree hit is someone else's session: never restart or reuse it —
start a pool instance (`electron-dev.sh start <id>`) or switch surface.

### L-S7 — Capturing evidence through a Vite that predates the code

`since 2026-08-06` · `holds-while: test-env.sh does not compare its resolved PORT with the running server, and nothing restarts Vite on a stale .vite/deps`

**Trap**, four shapes: the fixed version is in `node_modules` but a Vite started
before the install serves the old bundle for its lifetime; a leftover server
listens on a port that no longer matches `test-env.sh`, and the SPA dies with
`Failed to fetch dynamically imported module` while every module still returns
200 to `curl`; after a `git stash` the server keeps serving deleted files with
200; the dep optimizer wedges — `.vite/deps/*` answers 504 with a clean console
and `vite connected`.

**Rule:** prove the served bundle carries the change — fetch the relevant
`/node_modules/.vite/deps/*` chunk and grep a marker that cannot collide
(`SkillRow` also matches `addSkillRow`) — or restart the Vite **process**
(touching the config wedges the optimizer). Compare the running port with
`test-env.sh`'s resolved `PORT`; on a mismatch `stop-dev` and restart, and the
restarted server is yours to stop at teardown. On 504s from `.vite/deps`,
`rm -rf node_modules/.vite/deps` and restart Vite alone (`bun run dev:spa` is
its own process; reuse the same env file, leave the Next tree untouched).

### L-S8 — Reading a first-boot renderer crash as a defect of the change

`since 2026-08-10` · `holds-while: electron-dev.sh start reports Ready before the renderer is interactive`

**Trap:** the desktop Vite renderer serves a partially initialized module graph
on the first boot after a cold start; the app sits on the HTML shell with
`rootChildren: 0` and a TDZ `ReferenceError` from the router config.

**Rule:** reload once and re-probe before any conclusion. Only an error that
survives the reload belongs to the code.

### L-S9 — Trusting "migration pass" on the shared acceptance Postgres

`since 2026-08-16` · `holds-while: init-dev-env.sh migrate trusts drizzle's pass line, and every worktree shares lobehub-agent-testing-postgres`

**Trap**, two shapes: drizzle applies journal entries by `when` vs the newest
`created_at`, so a sibling worktree's same-numbered migration applied minutes
later makes yours skip silently with `✅ database migration pass` in \~40ms and
`relation ... does not exist` later; and a sibling suite truncates `postgres`
repeatedly, so a seeded user is gone seconds after `seed-user` reports success
(web auth 401 on `/api/auth/sign-in/email`).

**Rule:** after any migrate, assert the tables your fixtures need
(`select tablename from pg_tables where tablename like '<prefix>%'`); if
skipped, run the branch's SQL with `psql -v ON_ERROR_STOP=1` after stripping
`--> statement-breakpoint`, and treat the collision as a local artifact. Never
wait out or reset the shared database — create your own inside the container:

```bash
docker exec lobehub-agent-testing-postgres psql -U postgres -c "CREATE DATABASE <run>"
docker exec lobehub-agent-testing-postgres psql -U postgres -d "CREATE EXTENSION IF NOT EXISTS vector" < run > -c
export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/<run>"
```

`init-dev-env.sh` honours the inherited `DATABASE_URL` (PROJECT.md §2). Drop
the database at teardown and verify the shared one still holds the other
session's rows.

### L-S14 — Claiming an image property from the prompt that asked for it

`since 2026-08-20` · `holds-while: always`

**Trap:** "transparent background" is added to the prompt and proven by the
prompt diff and a screenshot; the artwork model returns JPEG (no alpha possible)
and paints a checkerboard.

**Rule:** decode the produced bytes and assert the property numerically (alpha at
corners vs subject, format signature, dimensions); show compositional properties
over a contrasting surface. When the model cannot deliver it, produce it in code
after generation.

### L-S16 — Treating a listening dev-server process as a healthy long-run probe

`since 2026-08-26` · `holds-while: project probe scripts carry no connect/total timeouts`

**Trap:** Next dev stays alive and accepts TCP while never answering HTTP; an
unbounded `curl` blocks the monitor exactly when the failure begins.

**Rule:** explicit connect and total timeouts on every probe, record `000` as an
observation, keep the monitor advancing, and prove recovery with a successful
application request.

### L-S17 — Diagnosing the feature when the dev DB lost its seeded user row

`since 2026-09-01` · `holds-while: setup-auth.sh status reports green without a users row`

**Trap:** the list endpoint returns `{ items: [] }` and writes die on the
`user_id` foreign key inside a giant `Failed query: insert …`; auth still reads
green because `ctx.userId` needs no `sessions` row.

**Rule:** when reads are empty AND writes fail, `select id from users` in the DB
the running server actually uses (from the env file it was launched with, never
`test-env.sh` defaults). Re-seed with `init-dev-env.sh seed-user`, prove with a
real write, and re-run `setup-auth.sh web-seed` — the SPA auth gate still
redirects to `/signin` after the row is recreated.

### L-S19 — Putting your own work plan into `result.json` `plan[]`

`since 2026-09-02` · `holds-while: ingest prints "N planned but not executed" as a summary line and still publishes`

**Trap:** `plan[]` filled with the agent's task list ("find the root cause",
"fix and add a test"); items without `id` are numbered `case-N` and render as
permanent **未执行** rows on the user's board.

**Rule:** `plan[]` holds only what the user would accept or reject, each with a
stable `id` a case in the same round fulfills; one criterion → one item. Read
the ingest summary line: clean is `plan: N item(s)` with nothing after. Repair by
folding bogus ids into the real check with `supersedes: ['case-1', …]` in the
next round — never `run delete`, which destroys the round's real evidence too.

### L-S20 — Bootstrapping the isolated stack on the script's default DB port

`since 2026-09-03` · `holds-while: init-dev-env.sh defaults DB_PORT=5433 / REDIS_PORT=6380 instead of reading the managed containers' ports`

**Trap:** on a machine where the managed containers were created on 5434/6381
(`docker ps` → `lobehub-agent-testing-postgres` on `0.0.0.0:5434`), the default
dials another project's Postgres — `password authentication failed`
(`routine: 'auth_failed'`), or worse, a successful migrate against a database
that is not ours, followed by a healthy page whose every tRPC write fails.

**Rule:** read the host ports from `docker ps` first and pass them to every
subcommand and to the backgrounded `dev`
(`DB_PORT=5434 REDIS_PORT=6381 init-dev-env.sh …`). `auth_failed` on migrate is
a port mismatch, never a credentials problem.

### L-S21 — Starting the dev server by a relative path from a worktree

`since 2026-09-01` · `holds-while: init-dev-env.sh derives REPO_ROOT from its invocation path, and a worktree session's shell cwd can reset to the main checkout between tool calls`

**Trap:** `.agents/acceptance/scripts/init-dev-env.sh dev` by relative path
starts the **main checkout's** stack: the port answers, auth succeeds, the page
renders — only the code under test is absent. The same reset sends
`bun run check` / `bunx vitest run` to main, where the pre-change test files
"pass". Fetching `/src/*` through the Next origin falls through to the SPA shell,
so a marker grep "fails" against `<!DOCTYPE html>` and reads as a stale bundle.

**Rule:** absolute paths from the worktree. Before evidence, prove the SPA's
identity: resolve the Vite pid from its port and read its cwd
(`lsof -a -p <pid> -d cwd -Fn`), fetch the changed module from the **Vite**
origin (the Debug Proxy port) and require a unique marker — or drive the feature
once and require its server call in the log. Before trusting any gate,
`pwd`/`cd <worktree> &&` and confirm the NAME of the test you added appears in
the runner output. Distinct from L-S7: that is a stale bundle from the right
tree; this is a healthy bundle from the wrong tree.
