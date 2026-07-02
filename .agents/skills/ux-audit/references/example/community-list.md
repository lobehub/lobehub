# Worked example — Discover / Community **list surfaces** audit (Round 1 of LOBE-11148)

A real run of this skill against the Desktop **Discover / Community** area's **8 list
surfaces**, 2026-07 — `home · agent · model · provider · skill · mcp · workspace ·
ws-settings` (`src/routes/(main)/community/(list)/**` + the workspace pages under
`(detail)/`). Use it as a **template for the output shape**, not as current-state truth
(the code moves; re-verify before citing). Round 2 (the 8 **detail** surfaces) is separate.

**Surface class:** a **marketplace / registry browse** area (class peers: VS Code
Marketplace, npm / npmjs, HuggingFace Hub, Raycast Store, Ollama library, GitHub Topics;
the two workspace pages are an **org/team public profile** + **org settings** — GitHub /
HuggingFace orgs). The class benchmark is what catches the entirely-absent capabilities L1
can't see from code (installed-state on cards, verified badges, contribute-to-marketplace).

**Layers run:** L1 (static / code) ✅ — everything below, from a 5-way parallel read (one
reader owned the shared store/service seam). L2 (visual) / L3 (dynamic + CLS) ⏳ not yet
run — see §5. Verdicts about the render (dominant control, does empty _read_ as a real
page, spacing, number overflow) are L1 inferences here, tagged **pending L2**.

**The one root cause under most of this.** Every Discover list is powered by
`useSWR(key, fetcher, { revalidateOnFocus: false })` with **no `onError`, no init flag, and
no `error` field in the store** (uniform across all 8 slices in `store/discover/slices/*`),
and **every call site destructures `{ data, isLoading }` and discards `error`**, then gates
`if (isLoading || !data) return <Loading/>` (`(list)/agent/index.tsx:18,29` + the 7 twins).
The fetcher rejects on failure (`services/discover.ts:106-119`) **and explicitly suppresses
the fallback notification** (`{ context: { showNotification: false } }`, `discover.ts:117`).
So a failed market fetch → `data` stays `undefined` → `!data` is permanently true → the
skeleton spins **forever**, no error, no retry, no toast, on the primary content of every
Discover tab. Fixing this once — at a shared list-shell / call-site convention that reads
`error` and renders failed/empty/loading uniformly — closes gaps ①②③④ at once.

## 1 — Patterns in use (consolidated across the 8 surfaces)

| Pattern (family)                                   | Where (block + file)                                                                | Rating  | Note                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------- |
| Global Navigation (nav)                            | sidebar `_layout/Sidebar/Header/Nav.tsx:36-77` (6 tabs)                             | ✅      | persistent, workspace-aware                                   |
| Clear Entry Points / Hub (nav)                     | home `(home)/index.tsx:37-45` featured sections + "more →"                          | ✅      | home spokes into agent / mcp lists                            |
| Deep-linking (nav)                                 | search/sort/page/category/source all in URL → SWR key                               | ✅      | state fully URL-restorable                                    |
| Grid of Equals / Card (layout)                     | every `features/List/index.tsx` `<Grid>` of `Item`                                  | ✅      | equal-weight clickable tiles                                  |
| Overview + Detail (data)                           | card `Item.onClick → navigate(detail)`                                              | ✅      | card → detail; add/install lives on detail                    |
| Dynamic Queries — server filter/sort/search (data) | `Search.tsx:38`, `SortButton/index.tsx:181-183`, `Category/index.tsx`               | ✅      | **server re-query, not client reorder** — highlight           |
| Pagination at scale (data)                         | `(list)/features/Pagination.tsx`, pageSize 21 (home 12)                             | ✅      | server-paged; scroll-to-top on change                         |
| Loading Skeleton (feedback)                        | `Loading/ListLoading/GridLoadingCard.tsx`                                           | ⚠️      | chrome-matched, but **permanent on error** (gap ①)            |
| **Failure + Retry (feedback)**                     | every list fetch                                                                    | — abs.  | **the dominant gap** — no surface reads `error` (①②)          |
| Empty-state (growth)                               | 5 `*Empty.tsx` + workspace lists                                                    | ⚠️      | real page but **no CTA**, **no-match variant dead** (③④)      |
| Verified / official badge (data)                   | mcp `Item.tsx:157-191` (`OfficialIcon`+`isValidated`); **skill: none**              | ⚠️      | present on mcp only — **skill card has no trust mark** (⑦)    |
| Number abbreviation (data)                         | skill/mcp `MetaInfo.tsx` raw `{installCount}`/`{stars}`; agent `TokenTag.tsx:43`    | — abs.  | no `formatShortenNumber` roll (gap ⑥)                         |
| Card "installed / added" state (data)              | every list `Item.tsx`                                                               | — abs.  | marketplace class norm missing on the tile (gap ⑤)            |
| Contribute / submit (growth)                       | header `CreateButton/Inner.tsx:44-50`                                               | ⚠️      | opens a docs modal → **GitHub**, no in-app submit (gap ⑧)     |
| Source / registry switch (nav)                     | `agent/features/MarketSourceSwitch.tsx`                                             | — orph. | built but **never mounted** — source only settable by URL (⑨) |
| Modal Panel (nav)                                  | `WorkspaceProfileModal` (`createModal`, base-ui)                                    | ⚠️      | `maskClosable:true` + in-memory draft (gap ⑩)                 |
| Autosave save-state (feedback)                     | `CommunityWorkspaceSettings.tsx:310-352` per-field Save                             | ✅      | explicit Save + toast — the §4.4 pattern done right           |
| Follow / social (growth)                           | workspace page: `FollowButton/FollowStats` **unused**; `followersCount:0` hardcoded | — abs.  | org profile isn't followable (class norm) (gap ⑪)             |

**Read:** the **browse spine is mature** (server filter·sort·search·paginate, chrome-matched
skeletons, working card→detail). The weakness clusters, in order: **Feedback — failure
handling** (①②, every fetch resolves only to success or hangs), **Read — empty-state
fidelity** (③④, no-match collapses into first-run onboarding; no CTA), **marketplace class
norms** (⑤⑦⑧, no installed-state, no verified-badge parity, contribute dead-ends to GitHub),
**consistency** (provider structurally diverges, skill vs mcp cards disagree), and a set of
**dead / orphaned controls** (⑨ + `Client.tsx`, `VirtuosoGridList`, `SearchResultCount`).

## 2 — Strengths / good cases (don't regress)

Unlike the Task / Eval / Memory / Pages audits, the **browse spine is genuinely strong** —
these are the ✅ half of the 回灌 loop and the "don't regress" list for the next refactor:

- **✅ 亮点 — Search・sort・category・pagination are all URL-driven and re-query the
  server** (→ landed as ux **Read §1.2** ✅, and _sharpened_ the rule with the latent sub-rule
  it teaches). `q` / `sort` / `page` / `category` flow into the SWR key (`libs/swr/keys.ts`;
  `Search.tsx:38`, `SortButton/index.tsx:181-183`, `Pagination.tsx`), so **none** of the
  client-side-filter-over-a-partial-page false-empty traps that bit every other list audit
  apply here — and the full browse state is URL-restorable. The teaching folded back: the
  **URL-as-source-of-truth mechanism** is _why_ server-query + deep-link + restore all hold at
  once.
- **✅ 亮点 — Skeletons reuse card chrome.** `ListLoading.tsx` / `GridLoadingCard.tsx` mirror
  the loaded card for a low-CLS in-place load→content swap (Feedback §4.1) — the read side's
  one solid piece of feedback hygiene (the failure branch above it is gap ①).
- **✅ 亮点 — Workspace write side is mature (→ cited as ux Feedback §4.4 ✅).** the profile
  modal, per-field settings Save, member sync, and avatar / banner uploads all do
  `try/catch/finally` + success/error toast (`CommunityWorkspaceSettings.tsx:310-352`,
  `WorkspaceProfileModal/Content.tsx:129-262`) — the discipline the read side should copy.
- **The no-match empty variant is already built.** The 5 `*Empty` components carry a `search`
  variant in their API (`AssistantEmpty.tsx:11-27` + twins); it's just never wired (gap ④), so
  fixing the false first-run empty is one-prop wiring, not a from-scratch build — a quiet
  head-start worth not regressing.

## 3 — Experience gaps (ranked)

**① Every list fetch can't fail → permanent skeleton, no retry, no toast — Feedback §4.2 / Read §1.1** 🔴
All 8 surfaces call `const { data, isLoading } = useXxxList(...)` and render
`if (isLoading || !data) return <Loading/>` — **`error` is never read**
(`(list)/agent/index.tsx:18,29`; `mcp/index.tsx:18,27`; `model/index.tsx:18,27`;
`provider/index.tsx:18,26`; `skill/index.tsx:18,27`; `(home)/index.tsx:20-32`; workspace
via a NotFound variant, gap ②b). The slices register **only** `revalidateOnFocus:false`
(`store/discover/slices/assistant/action.ts:69-83` + 7 twins) — no `onError`, no init flag;
`!data` **is** the success-only gate. The service both rejects **and** suppresses the
fallback notification (`services/discover.ts:117` `showNotification:false`). So when the
market fetch 500s / times out, SWR exhausts retries → skeleton (`ListLoading`) spins
**forever**, no reason, no Reload, not even a toast, on the primary content of every Discover
tab. This is the Eval/Task/Memory `onSuccess`-only trap in its **purest** form. Home
compounds it: `(home)/index.tsx:32` gates the whole page on **both** the assistant **and**
mcp lists, so one failed list hangs the entire home. _Remedy:_ read `error` at the call site
(or a shared list-shell); render a failed state with Reload (SWR `mutate` — already returned)
**before** the `!data` branch; gate each home section independently.

**② The list body never renders empty-or-error — only Loading or data; and workspace turns a failure into a 404 — Read §1.1** 🔴
Because the page gate is `!data`, the `<List>`'s own empty branch
(`agent/features/List/index.tsx:17` `if (data.length === 0) return <AssistantEmpty/>`) is
**only reachable on a successful empty response** — a failed fetch renders Loading, never
Empty, never error, and the route `error.tsx` boundary only catches _thrown_ render errors,
which a discarded SWR rejection is not. **(②b, the workspace spelling)** the public page
drops `error` (`workspace/index.tsx:40-46` destructures `{ data, isLoading, mutate }`) and
gates `if (!contextConfig) return <NotFound/>`, so a transient 500 tells the user the
**workspace doesn't exist** with no Reload (`mutate` is right there, unused) — the
failure-as-404 masquerade (Read §1.1). _Remedy:_ branch `error` to a reload state distinct
from a resolved not-found; keep the empty branch for genuine zero-rows.

**③ Category-count fetch failure silently coerces `error → []` → counts vanish, total reads 0 — Read §1.1** 🟠
Every category rail does `const { data: items = [] } = useXxxCategories(...)`
(`agent/features/Category/index.tsx:25` + model/skill/mcp twins) — `error` discarded. A
failed categories fetch renders the rail with **every count gone and the "all" total
computed to 0** (`:49`), telling the user the catalog is empty rather than "couldn't load".
The `data ?? [] → looks-empty` trap on the filter rail. _Remedy:_ read `error`; show counts
as unknown / a retry, not a false 0.

**④ The "no search results" empty is dead code — every zero-result search reads as first-run "nothing here yet" — Read §1.1 (empty variants) / §1.2** 🟠
All 5 `*Empty` components take a `search?: boolean` that swaps to the "no match" copy +
`type='default'` (`AssistantEmpty.tsx:11-27` + McpEmpty/ModelEmpty/ProviderEmpty/SkillEmpty
twins; i18n keys exist). **No List ever passes it** (`grep 'search={' ` over the area → 0
hits; every `features/List/index.tsx` renders `<XEmpty/>` bare). So `q=zzznomatch` returns
zero rows and shows the **onboarding "discover / create your first…" page** instead of "no
results for zzznomatch — clear filters," with no clear-filters affordance — the two distinct
screens the checklist requires collapsed to the wrong one, the built variant unreachable.
Also `SearchResultCount.tsx` ("N results for X") is imported by nothing, so a successful
search gives no "you searched X → N" affirmation either. _Remedy:_ thread `search={!!q ||
!!category}` (the query is already in scope) page → `List` → Empty, and add a clear-filters
action. One-prop wiring; the component work is done.

**⑤ Cards carry no "installed / added / owned" state — marketplace class norm miss — Act §3.4 / class benchmark** 🟠
No list `Item.tsx` reflects whether the user already has this agent / model / provider /
skill / mcp — an owned item looks identical to a new one, and the add/install lives only one
level down on the detail (`(detail)/mcp/.../ActionButton/index.tsx` already knows
`pluginSelectors.isPluginInstalled`; the list just doesn't read it). Every class peer (VS
Code Marketplace "Installed", Raycast "Added", Ollama) badges owned items on the browse
tile. An entirely-absent capability L1 catches only via the class benchmark (no `file:line`
to grep). _Remedy:_ read owned/installed state into the card; badge it (and/or offer inline
add for bulk↔single parity). **Note** skill "install" is a copy-prompt-to-agent flow
(`(detail)/skill/.../Platform.tsx:196`), so "installed" needs its own definition there first.

**⑥ Install counts / stars / tokens render raw — no K/M/B roll — Read §1.5** 🟠
skill/mcp `MetaInfo.tsx` render `{installCount}` / `{stars}` / `{commentCount}` verbatim
(a 40 000-install server prints `40000`), and agent `TokenTag.tsx:43` uses
`formatIntergerNumber` rather than the `formatUsageValue` ladder — while the shared
`formatShortenNumber` is already imported one directory over in `features/LikeButton.tsx`.
Registry install/star counts are exactly the "scan, don't account" case §1.5 names.
_Remedy:_ wrap the counts in `formatShortenNumber` (one-line import); token usage in
`formatUsageValue`. **(pending L2** for whether large values actually overflow the tag.)

**⑦ Cross-surface inconsistency — provider diverges structurally; skill vs mcp cards disagree on trust & meta — Certainty / consistency-is-semantic (Read §1.1)** 🟠
Two seams a per-surface split would miss: **(a)** of the five lists, agent/model/skill/mcp
each have a `_layout` mounting a `Category` rail; **provider has neither** (registered as a
bare route element, `desktopRouter.config.tsx:249-258`), so moving Models → Providers
silently drops the category facet and the whole layout shape changes. **(b)** the mcp card
shows an `OfficialIcon` + verified/validated badge (`mcp/Item.tsx:157-191`) and an
`InstallationIcon`; the **skill card has no trust mark at all** though skills are equally
installable third-party code, and the two meta rows disagree (skill: install+stars+comments;
mcp: install+stars) as do avatar shapes (round vs square). _Remedy:_ record
provider-has-no-category as an intentional decision or add the rail for parity; define **one
registry-card contract** (verified badge, install count, star count, what's-inside) and
apply it to both skill and mcp.

**⑧ "Create" is a dead-end docs modal → GitHub, not an in-app submit — Grow §5.3 / Act §3.1** 🟠
The header "Create" (`CreateButton`, shown on every non-custom-branding Discover page via
`_layout/Header.tsx:29`) opens a modal whose only action opens **GitHub** in a new tab
(`CreateButton/Inner.tsx:44-50` `window.open(AGENTS_INDEX_GITHUB)`). On a marketplace this is
the primary "contribute" affordance and it hands the user to an external repo with no
in-product path — the browse → contribute loop dead-ends. _Remedy:_ wire an in-app submit if
one exists, else rename the button (it over-promises "Create" for a docs link). **(pending
L2** for whether the GitHub button reads as the modal's dominant CTA.)

**⑨ Orphaned & dead controls/components — Certainty / maintenance** 🟡
`MarketSourceSwitch.tsx` is a complete, correct source toggle that **nothing mounts** — the
new/legacy market source is settable **only by hand-editing `?source=`** (the UI to change it
is orphaned). Alongside it: `agent/Client.tsx` (a near-duplicate of `index.tsx`, imported
nowhere), the `VirtuosoGridList` / `VirtuosoList` virtual-scroll components (imported
nowhere), `SearchResultCount.tsx` (gap ④), and the fully-built-but-commented-out
`WorkspaceSkillList` + `SubmitRepoModal`. _Remedy:_ mount `MarketSourceSwitch` (into
`(list)/_layout/Header.tsx`, agent-tab only) or delete it; prune the rest or gate it clearly.

**⑩ Workspace read-side & write-draft gaps — Read §1.1 / Edit §2.1 / Act §3.4** 🟠
The workspace pages are the exception to "read-only browse" (they edit), and their gaps are
read-side: **(a)** filtered/searched-empty renders a bare `<Grid>` with a `0` count — each
list gates `isEmpty` on the **raw** array not the **filtered** result while the status filter
defaults to `published` (`WorkspaceAgentList.tsx:56`, `filterWorkspaceMarketItems.ts:29`), so
an owner whose agents are all unpublished sees a titled section over blank space with no
"no match" state; **(b)** members table + settings have **no error branch** (a failed member
fetch reads as "no members yet", `CommunityWorkspaceSettings.tsx:202-216`; a failed profile
load renders a near-blank page, `:424-426`) — stub-blind on the closed hook, but the consumer
has no path regardless; **(c)** the profile modal is `maskClosable:true` over an in-memory
`useState` draft (`WorkspaceProfileModal/index.tsx:31`, `Content.tsx:75-81`) so a backdrop
misclick vaporizes a filled-out org profile incl. an uploaded banner (Edit §2.1, twin of the
create-task draft ❌); **(d)** members are display-only (Sync, no invite/role/remove — Act
§3.4, possibly intentional but should be surfaced copy); **(e)** settings doesn't close the
config→manage loop back to the public page (Grow §5.3). _Remedy:_ gate empty on the filtered
length + a `search`-variant empty; give members/settings a real error branch; `maskClosable:
false` (or a dirty-guard) on the modal; a "View public page →" link in settings.

**⑪ Org public profile isn't followable — class norm — Grow / class benchmark** 🟡
The workspace page hardcodes `followersCount:0 / followingCount:0`
(`workspace/index.tsx:71-72`) and renders no `FollowButton`/`FollowStats` (the user-profile
page has them, unused here). GitHub / HuggingFace orgs are followable — for an org public
profile, follow is a class norm. May be intentional for orgs; flag it. **(pending L2.)**

**⑫ Robustness / polish minors — correctness / i18n / Meaningful** 🟡

- provider card "view source" link hardcodes the **legacy `lobehub/lobe-chat`** path
  (`provider/Item.tsx:92`) — very likely 404; config now lives in `model-bank`. _(confirm the
  404 at L3.)_
- `ModelTypeIcon.tsx:32` `icon={icons?.[type]}` over a fixed 8-key map → an unknown/new model
  type renders a **blank badge** with a tooltip.
- model `Item.tsx:162` `date={releasedAt || dayjs().toISOString()}` fabricates **"published
  today"** for a model with no release date, on a sortable-by-release list.
- footer sign-in (`(list)/_layout/Footer.tsx:34-42`) `catch {}` conflates user-cancel with a
  real OAuth/network failure → a genuine sign-in error is swallowed silently (Feedback §4.2 /
  Act §3.5).
- search box seeds `word` from `q` once via `useState` (`Search.tsx:36`) → stale after tab
  switches (minor desync, Edit §2.2); and `handleSearch` **replaces** the whole query with
  just `q` (`:38-43`), dropping the active `category`/`sort`/`source` — searching inside a
  filter throws you back to the full catalog.
- skill card resource tag `{(resourcesCount||0)+1}` (`skill/Item.tsx:186`) is an unlabeled
  magic number.
- hardcoded `defaultValue: '创作的群组'` (`WorkspaceGroupList.tsx:61`) flags a possibly-missing
  i18n key. _(most of these are pending L2 for visual impact.)_

## 4 — Skill feedback (回灌)

- **Landed as strengthened `ux` items** from this audit:
  - Read **§1.1** — new ❌ example (a distinct sub-shape): the empty component **ships a
    `search`/no-match variant but the call site never passes it**, so a legitimate
    zero-result search renders the first-run onboarding empty — the 5 Discover `*Empty`
    components + bare `<XEmpty/>` at each `features/List/index.tsx:17` (gap ④). Mirrored into
    the Quick review.
  - Feedback **§4.2** — new ❌ example (the **purest** form yet): 8 Discover list slices
    register only `revalidateOnFocus:false`, `error` is discarded at every `{data,isLoading}`
    call site, `!data` **is** the success-only gate, and the service suppresses even the
    fallback toast (`showNotification:false`) — one root cause, 8 surfaces (gap ①).
  - Read **§1.5** — new ❌ example: registry **install/star counts render raw**
    (`{installCount}`/`{stars}` in skill/mcp `MetaInfo.tsx`) though `formatShortenNumber` is
    imported one directory over (gap ⑥).
  - Read **§1.9 (new)** — a **marketplace / registry browse-card class-norm** item: the tile
    must reflect **owned/installed state** and **trust badges (verified/official) consistently
    across sibling registries**, distinguish no-results from first-run, and route "contribute"
    to an in-app submit — named as a class norm so the absent affordance is caught (gaps
    ⑤⑦⑧). Mirrored into the Quick review.
- **Landed as ✅ good-case examples (the other half of 回灌 — each _sharpens_ the rule, not just decorates):**
  - Read **§1.2** — the good case (search·sort·category·page all URL-driven, §2) extracted a
    **latent sub-rule the rule didn't state**: making the **URL the single source of truth for
    list read-state and deriving the fetch key from it** is what makes server-query +
    deep-link + restore fall out _by construction_ — added as prose + a new checklist line +
    the Discover ✅ example + mirrored to the Quick review. (This is why the surface's only
    read-side gap is failure handling, not query correctness.)
  - Feedback **§4.4** — the workspace write side (§2) sharpened the rule from "**autosave**
    must surface state" to "**any** save mechanism must — and an **explicit per-field `Save`**
    is an equally valid convention that still owes the failure signal": added the distinction +
    the `CommunityWorkspaceSettings.tsx:310-352` ✅ example + updated the checklist line.
- **Validated existing rules** (good ❌ examples to cite): Read §1.1 failure-as-404 masquerade
  (gap ②b, workspace `!contextConfig → NotFound`); Read §1.1 always-rendered-chrome / real
  empty with CTA (gap ②/⑩a, bare `<Grid>` over a `0` count); Edit §2.1 in-memory draft lost
  on `maskClosable` close (gap ⑩c); Act §3.4 listed-entity lifecycle / installed-state (gap
  ⑤); Feedback §4.4 — the workspace **write side is a ✅** to cite (per-field Save +
  toast done right).
- **Noted, not yet landed** (promote if a second surface repeats): search that **replaces**
  the active filter scope instead of composing with it (gap ⑫); orphaned/dead UI controls as
  a Certainty smell (gap ⑨).

## 5 — Pending: L2 visual + L3 dynamic

L1-only; a later pass should confirm / quantify:

- **L2 (visual)** — does the permanent skeleton (gap ①) read as "still loading" indefinitely;
  do the `*Empty` "page"-type states read as real pages or dead space (gaps ②④⑩a); is the
  CreateButton GitHub button the dominant CTA (gap ⑧); does provider's missing category rail
  leave obvious dead space vs the model page (gap ⑦a); do raw counts overflow the tag (gap ⑥);
  dark mode + narrow width of the grids; CLS across skeleton → grid at pageSize 21.
- **L3 (dynamic)** —
  - Force any list fetch offline → **confirm gaps ①②** (permanent skeleton, no retry, no
    empty, no error) on every list; force the workspace fetch to 500 → **confirm gap ②b**
    (shows NotFound, no Reload).
  - Search a no-match term → **confirm gap ④** (onboarding empty, no clear-filters); force the
    categories fetch to 500 → **confirm gap ③** (counts silently vanish).
  - Seed a 40k-install server → **confirm gap ⑥** (raw `40000`); click a provider "view
    source" → **confirm gap ⑫** (404 on the legacy path).
  - **Measure list CLS/LCP** across skeleton → grid, and the source-switch / page-change
    refetch.
