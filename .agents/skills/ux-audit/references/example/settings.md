# Worked example — Settings area (设置区) systemic audit

A real run of this skill against the **whole settings area** (personal `/settings/*` +
workspace `/:slug/settings/*`), 2026-07. Unlike the per-page examples, this is a
**systemic / IA-level** pass: it audits the shared shell and cross-tab _consistency_ rather
than one surface. Use it as the template for a "audit an area as a system" run; per-tab
deep-dives are separate runs (see §6).

**Layers run:** L1 (static / code) ✅ — everything below. L2 / L3 ⏳ not run.

**Scope & blind spot:** personal 26 + workspace 15 = 41 surfaces. **Business-injected tabs
are empty stubs in this OSS repo** (`return null`): workspace `general / members /
audit-log / plans / billing / credits / usage`, personal `notification / plans / credits /
billing / referral / usage` (`src/business/client/BusinessSettingPages/*`). L1 from this
repo **cannot** audit them — they need the cloud build (L2/L3) or the business package.
Findings below cover the shared shell + the \~17 code-readable tabs.

## Surface map (load-bearing files)

- **Personal shell:** `src/routes/(main)/settings/_layout/index.tsx` (SideBar + Outlet),
  `_layout/Body/index.tsx` (accordion nav), `_layout/Header.tsx` (breadcrumb),
  `features/SettingsContent.tsx` (tab dispatch + `SettingContainer` wrap), tab catalog
  `hooks/useCategory.tsx`.
- **Workspace shell:** `src/features/WorkspaceSetting/Layout.tsx`, `SideBar/Body.tsx`,
  `Container/index.tsx`, catalog `hooks/useCategory.tsx`.
- **Mobile catalog (3rd copy):** `src/routes/(mobile)/me/settings/features/useCategory.tsx`.
- **Tab enums:** `SettingsTabs` (`src/store/global/initialState.ts`),
  `WorkspaceSettingsTabs` (`src/types/workspaceSettings.ts`).

## 1 — Patterns in use (systemic)

| Pattern (family)             | Where                                                    | Rating | Note                         |
| ---------------------------- | -------------------------------------------------------- | ------ | ---------------------------- |
| Global Navigation / Fat Menu | sidebar `Accordion`, 4 groups (`_layout/Body/index.tsx`) | ✅     | grouped, default-expanded    |
| Deep-linking                 | `/settings/:tab`, `:tab/:sub` (messenger/discord)        | ✅     | URL restores tab             |
| Visual Framework             | `SettingContainer maxWidth=1024`, personal + workspace   | ✅     | consistent chrome            |
| Breadcrumbs                  | `_layout/Header.tsx` — single "设置" level               | ⚠️     | doesn't deepen per tab       |
| **Search / Jump-to-setting** | —                                                        | — abs. | \~25 tabs, no search (gap ⑤) |
| Titled Sections / FormGroup  | per-tab `Form` / `FormGroup`                             | ✅     |                              |
| Good / Smart Defaults        | autosave-on-change is the dominant model                 | ✅     | no explicit Save button      |
| **Failure + Retry**          | —                                                        | — abs. | area-wide (gaps ①②)          |
| Loading Skeleton             | most tabs skeleton; Creds / Profile use antd `Spin`      | ⚠️     | §4.1 (gap ⑥)                 |
| Empty-state as onboarding    | Devices / Creds / Messenger have CTA empties             | ✅     | highlight                    |
| Entity lifecycle             | Devices / APIKey / Creds full CRUD, Devices bulk-select  | ✅     |                              |

**Read:** navigation / layout / defaults are mature; data-tab empty states are good.
Weakness clusters hard in **Feedback (failure + autosave feedback)** and **cross-tab
consistency / IA**.

## 2 — Strengths / good cases (don't regress)

The settings area is strong where it counts — these are the ✅ half of the 回灌 loop and the
"don't regress" baseline for each per-tab deep-dive:

- **✅ 亮点 — Grouped accordion nav over consistent chrome.** The sidebar `Accordion` splits \~25
  tabs into 4 default-expanded groups (`_layout/Body/index.tsx`) over a `SettingContainer
maxWidth=1024` shell shared by **both** personal and workspace, so every tab wears the same
  chrome. Navigation / layout / defaults are the mature core the rest hangs off.
- **✅ 亮点 — CTA-carrying empty states on the data tabs.** Devices / Creds / Messenger render
  their "nothing here yet" branch as onboarding with a next-step CTA, not a dead end — the
  empty state doubles as the entry point to configure the feature.
- **✅ 亮点 — Full entity lifecycle with bulk-select.** Devices / APIKey / Creds ship complete
  CRUD, and Devices adds bulk-select for mass management (`DeviceManager.tsx`), the excellent
  empty + bulk-select combo the per-tab pass called out.
- **✅ 亮点 — Storage import path is well-built.** The import flow is a proper state machine
  (preview + progress), the one pocket of resilience craft in a tab whose destructive clear-all
  is otherwise the audit's biggest stakes (`Advanced.tsx`).
- **✅ 亮点 — Creds secret-masking + 2-variant empty.** Credentials mask secrets and carry a
  2-variant empty state (`CredsList.tsx`) — the right handling for sensitive values, and the ✅
  half of a tab whose error-as-empty leg still needs fixing.
- **✅ 亮点 — Workspace Body validates the tab enum.** `SideBar/Body.tsx:25` validates the
  active tab against `WorkspaceSettingsTabs` — the ✅ contrast to personal's silent-Appearance
  fallback for unknown deep-links (`SettingsContent.tsx:40`, gap ⑧).

## 3 — Experience gaps (ranked)

**① No error/retry anywhere in the settings area — ux §4.2** 🔴 Not one tab has a terminal
failure + retry. Two failure modes: (a) init-flag set only on success → **permanent
skeleton**: Storage (`storage/index.tsx:18`), Memory (`memory/features/Memory.tsx:28`),
ServiceModel (`features/ServiceModel/ModelAssignmentsForm.tsx:64`), Profile
(`profile/index.tsx` composite `isLoading`); (b) SWR/Query error swallowed → empty or
infinite spinner: Devices (`features/DeviceManager/DeviceManager.tsx:331`), Messenger,
Creds, Stats, APIKey. Only recovery is a full app reload. The single biggest, most uniform
issue.

**② Autosave failures are silently swallowed — ux §4.2 / §3.5** 🔴 Dominant save model is
`Form onValuesChange → setSettings`. Appearance, Advanced, Hotkey (Essential/Conversation)
give **no success and no failure feedback** — a toggle that failed to persist looks
identical to one that succeeded (config-loss / trust). Profile / Desktop-hotkey / Proxy do
surface an error but offer **no retry**.

**③ Save feedback is fragmented across tabs — Certainty (consistency is semantic)** 🟠 Same
intent ("change a setting") → different feedback: silent (Appearance/Advanced/hotkey-
essential), inline `message.success` (Desktop hotkey), `notification.success` (Profile
password), toast on _test_ not save (Proxy). `Form` / `SettingContainer` / `FormGroup`
provide layout but **no save-state affordance**, so nothing forces convergence.

**④ Error indistinguishable from empty — ux Read §1.1** 🟠 Stats, Messenger, Creds render
their "no data" branch on a _failed_ fetch (`data === undefined`), so "load failed"
masquerades as "nothing configured" (Messenger `noPlatformsConfigured`, Stats empty charts).

**⑤ No settings-wide search — surface-class benchmark** 🟠 \~25 personal tabs in 4 groups;
mature settings surfaces (VSCode / Slack / GitHub / macOS) ship settings search /
jump-to-setting. The shell has only accordion nav + breadcrumb — no search input. A class-
norm gap a code-only read is structurally blind to. (pending L2 to confirm none elsewhere.)

**⑥ antd `Spin` where the design system forbids it — ux §4.1** 🟡 Profile rows
(`UsernameRow.tsx:5,95`, `FullNameRow`, `AvatarRow`) and `CredsList.tsx:6,77,97` use antd
`Spin` instead of `NeuralNetworkLoading` / skeleton.

**⑦ Tab catalog hand-duplicated 3× and drifted — Certainty / maintainability** 🟡 Defined
independently in `hooks/useCategory.tsx` (desktop personal),
`WorkspaceSetting/hooks/useCategory.tsx`, and
`(mobile)/me/settings/features/useCategory.tsx`. Already diverged: mobile omits Devices,
Notification, Messenger, Hotkey, Proxy, SystemTools — a phone user **cannot reach
Devices / Messenger / Notification settings at all**. Three parallel copies guarantee
future drift (same class the `desktopRouter.sync.test` guards for routes).

**⑧ Unknown `/settings/<garbage>` silently renders Appearance — ux Read §1.1 / Certainty**
🟡 `SettingsContent.tsx:40` falls back to `componentMap.appearance` for any unrecognized
tab; personal active-tab detection (`Body/index.tsx:20`, `pathParts[2]`, no enum
validation) highlights nothing. A bad deep-link shows Appearance with no nav highlight
instead of a not-found. Workspace Body **does** validate (`SideBar/Body.tsx:25`) — the two
halves are inconsistent.

**⑨ `Security` is a dead redirect still carried as a tab — Growth / cleanliness** 🟡
`security/index.tsx` is only `<Navigate to="/settings">`, yet `Security` remains in the
`SettingsTabs` enum, `componentMap`, and `SettingsContent`'s mobile-prop list. Real content
moved into Profile (PasswordRow / SSO / Email). Dead surface to prune.

## 4 — Skill feedback

- **Validated existing rules** (❌ examples to cite): §4.2 (①②, incl. init-flag-success-
  gated permanent skeleton), §4.1 (⑥), Read §1.1 (④⑧), §3.5 (②).
- **Landed as new / strengthened `ux` items** from this audit:
  - Feedback **§4.4 Autosave feedback & one save convention per surface** (gaps ②③).
  - Read **§1.8 Search / filter a config surface at scale** (gap ⑤).
  - Read **§1.1 strengthened** — error must be checked **before** the empty branch; a failed
    fetch never renders as empty (`data ?? [] → Empty` trap; 7 settings tabs).
  - Act **§3.7 Irreversible / high-blast-radius actions need elevated confirmation**
    (type-to-confirm + report partial failure; Storage clear-all).
  - Act **§3.8 Secrets revealed once, stored hashed, masked thereafter** (APIKey class norm).
  - Grow **§5.3 Close the config → manage loop with a near entry point** — a config surface
    for a feature with its own data/management area must link to it in-context, not just
    promise it in copy. ❌ example: Memory settings has no link to `/memory`. **Also patched the
    L1 procedure** (`layer-1-static.md` step 3) to ask this cross-surface check on every surface
    — this gap was under-framed as "dead copy" in the first pass because L1 is structurally
    blind to an entry point that was never built (no `file:line`).
  - review-checklist **"Single-source the nav/tab catalog"** (gap ⑦).
- **Noted, not yet landed:** breadcrumb that doesn't deepen per tab (⑧-adjacent) — promote
  if a second surface repeats it.

## 5 — Pending: L2 visual + L3 dynamic

- **L2** — confirm no settings search is rendered anywhere (gap ⑤); confirm the antd `Spin`
  rows read visually off from the rest (⑥); check dark-mode + narrow-width of the accordion
  sidebar; confirm empty vs error render differences (④).
- **L3** — force each store/SWR fetch offline to **confirm gaps ①②④ live** (permanent
  skeleton; silent autosave failure; error-as-empty); walk mobile to confirm the missing
  Devices/Messenger/Notification tabs (⑦); measure settings-tab-switch INP.

## 6 — Phase B: per-tab deep-dive queue (sub-issues under LOBE-11078)

The systemic 🔴 (①②③) are **cross-cutting** — file as ONE "settings resilience" issue, not
per tab. Then deep-audit each tab (`/ux-audit <tab>`), priority by user-path heat:

| Prio    | Surface                                                                                                | Why deep-audit                                                  |
| ------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| P0 xcut | settings error/retry + autosave feedback                                                               | ①②③ one systemic fix                                            |
| P1      | Provider (full-bleed, biggest)                                                                         | not covered this pass; model/key core path                      |
| P1      | Profile (entry tab)                                                                                    | autosave rows + antd Spin + composite isLoading                 |
| P2      | Skill (full-bleed marketplace)                                                                         | multiple antd Spin                                              |
| P2      | ServiceModel                                                                                           | model assignment core + init-flag skeleton                      |
| P3      | Appearance / Advanced                                                                                  | silent autosave-failure exemplars                               |
| P3      | Devices / Creds / APIKey / Messenger / Stats / Storage / Memory / Hotkey / Proxy / SystemTools / About | state-handling covered; finish full pattern/i18n/hierarchy pass |

## 7 — Per-tab L1 deep-dive findings (2026-07, all 17 code-readable tabs)

Each tab was re-audited full-depth (patterns + all ux modules). Severity-tagged one-liners
with `file:line`; the recurring systemic roots (§4.2 success-only skeleton, §4.4 silent
`setSettings`/mutation with no catch, error-rendered-as-empty, antd `Spin`) are marked
**\[sys]**. Verdicts about the render are **pending L2**.

**Provider** 🔴🔴🔴 — every mutation in `aiInfra/slices/{aiProvider,aiModel}/action.ts` has no
try/catch: config autosave swallowed + spinner hangs (`aiProvider/action.ts:345`), toggles
don't roll back on failure (`:315`, `aiModel/action.ts:137`); list/model init success-only →
permanent skeleton (`:444`, `aiModel/action.ts:172`) **\[sys]**; model fetch error → misleading
`EmptyModels`; create/update/delete modals `catch{console.error}` no in-modal error. Strong
patterns (Overview+Detail, search, source-gated CRUD). **Needs issue.**

**Skill** 🔴🔴🔴 — 4 list SWR returns discarded, no error/loading on the left list
(`SkillList.tsx:124`) **\[sys]**; empty state has no CTA + goes fully blank on the wrong
view-tab (`SkillList.tsx:324-338`); install/connect errors → `console.error`, no save-state
(`AgentSkillItem.tsx:130`, `ComposioSkillItem.tsx:176`); sync error → "no permissions"
(`SkillDetail/index.tsx:240`); no search/virtualization (marketplace at scale). **Needs issue.**

**ServiceModel** 🔴🔴 — success-only init skeleton (`ModelAssignmentsForm.tsx:64`) **\[sys]**;
autosave no-catch + optimistic value persists on failure (`:76-94` + `settings/action.ts:189`)
**\[sys]**; 🟠 capability machinery (`requiredAbilities`) exists but every `ModelSelect` passes
`showAbility={false}` — assign an incapable model, no warning (§4.3); no no-models state. **Needs issue.**

**Profile** 🔴🔴 — antd `Spin` in `UsernameRow.tsx:95`, `FullNameRow.tsx:43`, `AvatarRow.tsx:90`
(§4.1); composite `isLoading` success-only → whole tab permanent skeleton if authProviders/
composio fetch fails (`profile/index.tsx:56`) **\[sys]**; 🟠 5 rows confirm 5 different ways;
optimistic interests can diverge silently (`InterestsRow.tsx:31`); password/email use transient
toast not persistent state (§3.5); 🟡 hardcoded `'Failed to change email'` (`EmailRow.tsx:52`). **Needs issue.**

**Appearance** 🔴 — canonical §4.4 exemplar: 3 different save mechanisms
(`Common.tsx:179`, `Appearance/index.tsx:58`, `ChatAppearance/index.tsx:35`), all silent, all
no try/catch/finally → failed save hangs spinner + loses config **\[sys]**; 🟠 success-only
skeleton **\[sys]**; strong Illustrated Choices + live Preview. **Needs issue.**

**About** 🟡 — **healthy.** Only gap: version/update check has no `onError` → a failed check is
silent / looks "up to date" (`general.ts:189,214`, `Version.tsx`). Titled sections, external-link
affordances, `Button loading` (no `Spin`), clean i18n. **Low — fold into systemic or skip.**

**Advanced** 🔴 — autosave + lab toggles silent no-catch → spinner hangs, silent loss
(`advanced/index.tsx:265`, `preference/action.ts:39`) **\[sys]**; 🟠 success-only skeleton **\[sys]**;
🟡 Labs (Fleet/iMessage/Connect-Agent) applied instantly with **no "experimental" risk framing**
(§4.3/§3.4). **Needs issue.**

**Proxy** 🔴🔴 — the one explicit-Save tab, and Save gives neither success nor failure feedback:
`proxy.saveSuccess` locale key is **dead/unused** and `handleSave` has an **empty `catch{}`**
(`ProxyForm.tsx:156-166`); 🟠 no draft-loss guard on navigate-away (`useBlocker` absent, §2.1);
🟠 `error` never read from SWR → no load-error state. **Needs issue.**

**Hotkey** 🔴🔴 — §4.4 twice: 3 save conventions on one page (Desktop toast vs Essential/
Conversation silent, `Desktop.tsx:42` vs `Essential.tsx:83`/`Conversation.tsx:83`) **\[sys]** +
silent autosave failure; 🟠 **Desktop group alone lacks client-side conflict detection**
(`Desktop.tsx:56`, others pass `hotkeyConflicts`); 🟠 success-only skeleton **\[sys]**. **Needs issue.**

**SystemTools** 🔴🔴 — owns `BinaryStatus.error` from the IPC contract but throws it away: per-tool
detection failure renders identical to "not installed" (`ToolDetectorSection.tsx:76-124`), and a
whole `detectAll` rejection → silent all-"Not detected" (`:136`) **\[sys, error-as-empty]**; 🟠
undetected tools dead-end with no install path (§3.1). Read-only otherwise (healthy structure). **Needs issue.**

**Storage** 🔴🔴 — **clear-all data** (agents/files/messages/skills) has **no try/catch** + a plain
one-click danger confirm with **no type-to-confirm** for an unrecoverable wipe (`Advanced.tsx:46-65`);
partial-failure → half-deleted data, modal open, zero feedback; 🟠 success-only skeleton **\[sys]**;
🟠 telemetry toggle silent-fail + snap-back (`:156`); 🟡 export fire-and-forget. Import path is
well-built (state machine + preview + progress). **Needs issue (highest destructive stakes).**

**Devices** 🔴 — SWR `error` never read → a failed load renders the **onboarding "connect your
first device" empty**, falsely telling the user they own none (`DeviceManager.tsx:304→310→334`)
**\[sys, error-as-empty]**; 🟠 bulk-delete = mass device revocation with no "this is your current
session" warning though `isCurrent` is computed (§3.6); 🟠 bulk/per-row delete has no error leg
(`Promise.all` no catch). Excellent empty state + bulk-select. **Needs issue.**

**Stats** 🔴🔴 — every widget success-only + `loading={isLoading || !data}` → any fetch failure =
**permanent skeleton** (`ModelsRank.tsx:50`, etc.) **\[sys]**; **§1.5 number trap**: `formatTokenNumber`
caps at `M` (`packages/utils/src/format.ts:91`) → `5000M`/`12000M`, and `formatNumber` doesn't
abbreviate at all; 🟠 antd `Spin` in shared `StatisticCard` (`components/StatisticCard/index.tsx:166`);
🟡 hardcoded `'ID'`/`'Chat'` table strings. **Needs issue.**

**Creds** 🔴🔴 — **4 bare antd `<Spin/>`** (`CredsList.tsx:77,97`, `EditKVForm.tsx:127`,
`OAuthCredForm.tsx:79`, §4.1); list query `error` never read → failure renders as "no credentials"
(`CredsList.tsx:47,100`) **\[sys, error-as-empty]**; 🟠 no create/edit/delete mutation has an
`onError` leg; 🟡 edit decrypt failure swallowed → blank overwrite (`EditKVForm.tsx:75`); 🟡
hardcoded English placeholders. Good secret-masking + 2-variant empty. **Needs issue.**

**APIKey** 🔴🔴 — **inverts the API-key class norm**: `query()` decrypts + returns full plaintext on
every list fetch (`packages/database/src/models/apiKey.ts:93`), masked client-side only with an
eye-toggle (`ApiKeyDisplay/index.tsx:32`); **no one-time create reveal** — modal just closes,
mutation result discarded (`ApiKey.tsx:49`, `Content.tsx:36`); 🟠 no error/retry on failed `request`;
🟠 inline edit/toggle silent-fail; antd default empty. **Needs issue (security + UX).**

**Memory** 🔴 — inherits silent-autosave no-catch (`Memory.tsx:63,91` + `settings/action.ts:189`)
**\[sys]**; 🟠 success-only skeleton **\[sys]**; 🟠 capability-gated feature with **no warning** when no
memory model is configured (set on a different tab, §4.3); 🟠 copy promises "view/edit/clear memory
anytime" but renders **no link** to `/memory` (dead promise); 🟡 dead empty tooltips (`usePermission`
stub). Small clean form otherwise. **Needs issue.**

**Messenger** 🔴 — platform-list `error` never read → failure renders "noPlatformsConfigured"
(`Messenger/index.tsx:118,135`) **\[sys, error-as-empty]**; 🟠 detail panes success-only → permanent
skeleton on error (`shared.tsx:386`, `Slack.tsx:58`) **\[sys]**; 🟠 OAuth connect is a bare link →
toast-only outcome, no in-progress/done machine (§3.1/§3.5, partly mitigated by list refetch); 🟡
Slack pending state strands vs Discord's CTA. **Needs issue.**

### Cross-tab tally

- **error-rendered-as-empty \[sys]** (highest-frequency): Devices, Messenger, Creds, Stats, Skill,
  SystemTools, Provider (model list). 7 tabs render a failed fetch as "nothing here".
- **success-only init skeleton \[sys]**: Storage, Memory, ServiceModel, Profile, Appearance, Advanced,
  Hotkey, Provider, Stats. 9 tabs.
- **silent autosave / mutation no-catch \[sys]**: Appearance, Advanced, Memory, ServiceModel, Hotkey,
  Provider, Profile, Devices-detail, APIKey, Creds, Storage-telemetry. \~11 surfaces.
- **antd `Spin` (§4.1)**: Profile (3), Creds (4), Stats (StatisticCard). 3 tabs.
- **class-norm gaps** (code-blind, benchmark-only): APIKey one-time-reveal 🔴, Stats §1.5 rollover 🔴,
  settings-wide search ⑤, Storage type-to-confirm, Memory capability warning, SystemTools install path.
- **Healthy**: About (1 low gap). SystemTools structurally healthy bar the error-state gap.
