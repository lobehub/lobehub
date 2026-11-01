# Worked example — Onboarding module systemic audit

A real run of this skill against the **whole Onboarding module** (first-run setup), 2026-07.
Like the settings example this is a **systemic** pass across a small family of related
surfaces rather than one screen. Onboarding is the surface class the pattern catalog's
_Getting started_ family (Welcome / Guided Tour / Empty-state-as-onboarding) benchmarks.

**Layers run:** L1 (static / code) ✅ — everything below. L2 / L3 ⏳ not run (no render / no
running env this pass). Visual verdicts (real button dominance, does a progress bar render)
are tagged **pending L2**.

## Scope — three parallel flows behind two entry points

| Flow                     | Route(s)                           | Screens (in order)                                  | Orchestrator                                    |
| ------------------------ | ---------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| **Common prefix**        | `/onboarding` (`?step=1\|2`)       | Telemetry → ResponseLanguage                        | `features/Onboarding/Common/index.tsx`          |
| **Classic** (web/mobile) | `/onboarding/classic`              | FullName → Interests → \[ProSettings] → AgentPicker | `features/Onboarding/Classic/index.tsx`         |
| **Agent** (web/mobile)   | `/onboarding/agent`                | single conversational step                          | `features/Onboarding/Agent/index.tsx`           |
| **Desktop** (Electron)   | `/desktop-onboarding` (`?screen=`) | Welcome → \[Permissions·mac] → DataMode → Login     | `routes/(desktop)/desktop-onboarding/index.tsx` |

Common funnels into Classic **or** Agent via `deriveOnboardingBranchPath` (`branch.ts:18`);
build switch `AGENT_ONBOARDING_ENABLED` + runtime `enableAgentOnboarding` + `!isDesktop`
gate the Agent branch. Step chrome is shared via `routes/onboarding/_layout` (web) and
`routes/(desktop)/desktop-onboarding/_layout` (desktop).

**Persistence / resume (healthy):** classic step is server-persisted (`onboarding.currentStep`

- `finishedAt`, `onboarding/action.ts:26-137`) with an optimistic `localOnboardingStep` and a
  coalescing update queue; desktop resumes via `resolveInitialScreen` (URL → saved → everCompleted
  → Welcome, `resolveInitialScreen.ts:28`). Returning users skip via `needsOnboarding`
  (`selectors.ts:26`). Callback-URL threading survives the whole flow (`utils/onboardingRedirect`).

## 1 — Patterns in use

| Pattern (family)                    | Where                                                            | Rating | Note                                                     |
| ----------------------------------- | ---------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| Welcome / Sign-on                   | Telemetry (`TelemetryStep.tsx`), desktop Welcome                 | ✅     | purposeful first screen, typewriter intro                |
| Guided Tour / Onboarding (stepwise) | Common + Classic linear steps                                    | ⚠️     | steps exist but **no progress/Sequence Map** (gap ③)     |
| **Sequence Map / progress**         | —                                                                | — abs. | up to 6 classic / 4 desktop screens, no "N of M" (gap ③) |
| Escape Hatch (skip)                 | AgentPicker skip; layout skip only in agent-branch mode          | ⚠️     | no skip in pure classic until final step (gap ⑤)         |
| Deep-linking                        | `?step` (web), `?screen` (desktop) restore position              | ✅     | canonicalized, resumable                                 |
| Empty-state as onboarding           | AgentPicker empty vs error distinguished (`index.tsx:162-167`)   | ✅     | good — but error has no retry (gap ④)                    |
| Loading Skeleton                    | AgentPicker skeleton, Agent brand loader, desktop Suspense       | ✅     | project loaders, no antd `Spin`                          |
| Failure + Retry                     | desktop LoginStep full idle/loading/success/error + retry+cancel | ✅     | **exemplary** — model this elsewhere                     |
| Failure + Retry                     | web write-steps + AgentPicker install/load                       | — abs. | gaps ①②④⑥                                                |
| Progress Indicator / Cancelability  | desktop LoginStep auth countdown + cancel (`LoginStep.tsx:293`)  | ✅     |                                                          |
| Prominent "Done" Button             | one primary per step throughout                                  | ✅     | pending L2 for dominance                                 |
| Illustrated Choices                 | Interests grid, desktop DataMode                                 | ✅     |                                                          |

**Read:** the _state machine_ work (desktop Login, resume, optimistic queue, callback
threading, Agent bootstrap→classic fallback) is mature. Weakness clusters in **Feedback
(failure/retry on the web write-steps)** and one **Navigation** class-norm gap (no progress /
weak escape hatch).

## 2 — Strengths / good cases (don't regress)

The module is strongest exactly where gap-hunting can miss it — the state-machine and
resume plumbing. These are the ✅ half of the 回灌 loop and the "don't regress" list for the
next onboarding change; one is strong enough to land as a **✅ example in `ux`** (see §4).

- **✅ 亮点 — Desktop `LoginStep` state machine (→ ✅ exemplar for Feedback / Failure+Retry).** Full
  idle / loading / success / error with **retry + cancel + an auth countdown**, driven by main-process
  broadcasts (`authorizationSuccessful` / `Failed` / `Progress`) and reconciled against real
  remote config (`routes/(desktop)/desktop-onboarding/features/LoginStep.tsx`). This is the
  exemplary Failure+Retry pattern the web write-steps (gaps ①②④⑥) should copy.
- **✅ 亮点 — Resume /persistence.** Classic step is server-persisted (`onboarding.currentStep`
  - `finishedAt`) behind an optimistic `localOnboardingStep` and a **coalescing update queue**
    that survives rapid clicks (`store/user/slices/onboarding/action.ts:57-123`); desktop resumes
    via `resolveInitialScreen` (URL → saved → everCompleted → Welcome,
    `resolveInitialScreen.ts:28`); returning users skip entirely via `needsOnboarding`
    (`selectors.ts:26`). An interrupted onboarding reopens at the right step.
- **✅ 亮点 — Agent bootstrap error degrades to Classic, not a blank.** A failed bootstrap query
  redirects into the deterministic classic flow rather than stranding the user in a broken
  conversation (`features/Onboarding/Agent/index.tsx:330-335`) — graceful degradation to the
  reliable baseline. (Its sibling `ErrorBoundary fallbackRender={() => null}` at `:372` is the
  one weak spot — see the note under §3.)
- **✅ 亮点 — WrapUp is a proper confirm → in-progress → done with `finally`.** `WrapUpHint`
  runs `confirmModal` before finishing and resets `loading` in a `finally`
  (`features/Onboarding/Agent/WrapUpHint.tsx:35-52`) — the exact shape the language-gate write
  (gap ①) is missing.
- **✅ 亮点 — Callback-URL threading.** The signup target is stashed, survives the whole
  multi-step flow, is consumed on finish, and passes a safe-redirect guard
  (`utils/onboardingRedirect`, `AgentPickerStep/index.tsx:114`) — a first-run detour that
  returns the user to where they were headed.
- **AgentPicker empty-vs-error distinction.** Renders `failedToLoad` vs `empty` distinctly
  (`AgentPickerStep/index.tsx:162-167`) — error ≠ empty done right (the missing retry is gap ④,
  not a knock on the distinction). Resumable, canonicalized deep-links (`?step` / `?screen`).

## 3 — Experience gaps (ranked)

**① ResponseLanguage — the shared-prefix gate write has no failure path → permanent stuck
step — ux Feedback §4.2** 🔴 `handleNext` sets `isNavigating=true`, then
`await setSettings({ general: { responseLanguage } })` with **no try/catch/finally**
(`ResponseLanguageStep.tsx:37-43`). That write is _the_ signal `commonStepsCompleted` keys off
(`selectors.ts:44`). If it rejects (network blip), `onNext` never fires and `isNavigating`
never resets → both Send **and** Back stay `disabled` forever, with no error and no retry: the
user is trapped on the language screen and cannot enter the product. The one write that gates
the whole flow is the one with zero failure handling.

**② AgentPicker — agent install failure is swallowed, then onboarding finishes anyway — ux
Feedback §4.2 / Act §3.5** 🔴 `handleContinue` wraps `installMarketplaceAgents` in a
`catch { console.error }` and proceeds to `finish('continue') → finishOnboarding()` → navigate
away regardless (`AgentPickerStep/index.tsx:135-140`). The user hand-picked agents, they
silently failed to install, and they land in an app missing them with no clue. The entire
point of the final step can fail invisibly.

**③ No progress / Sequence Map in any flow — surface-class benchmark (Navigation)** 🟠 Classic
runs up to 6 sequential screens (telemetry→language→fullname→interests→\[prosettings]→
agentpicker); desktop 3–4. Neither shows "Step N of M" or a progress bar — the only `<Steps>`
in the module are **decorative feature lists** inside Telemetry/Welcome (`current={null}`,
`TelemetryStep.tsx:82`, `WelcomeStep.tsx:72`). Setup wizards (Notion / Linear / Slack / Vercel)
universally show length + position. Users can't gauge how long onboarding is. (pending L2 to
confirm nothing renders.)

**④ AgentPicker error state has no retry — ux Feedback §4.2** 🟠 Template load failure renders
bare `agentMarketplace.picker.failedToLoad` text (`AgentPickerStep/index.tsx:160-167`) — no
Reload. Empty-vs-error _is_ correctly distinguished (good), but the final step's core capability
is lost with recovery only by abandoning via Skip.

**⑤ FullName is mandatory and the classic flow has no escape hatch until the last step —
Navigation → Escape Hatch** 🟠 FullNameStep's only forward control is the SendButton, `disabled`
until a non-empty name (`FullNameStep.tsx:74`); there is no Skip / Next-without-name. The layout
Skip link only renders in agent-enabled branch mode (`_layout/index.tsx:45-50`), so a pure
classic flow forces the user through telemetry/language/fullname/interests/prosettings with no
skip until AgentPicker. Class norm: optional profile steps should be skippable; identity setup
shouldn't hard-block first entry.

**⑥ Profile-step writes are fire-and-forget with no failure feedback — ux Feedback §4.2 / Act
§3.5** 🟡 FullName (`FullNameStep.tsx:34`), Interests (`InterestsStep.tsx:72`), Telemetry
(`TelemetryStep.tsx:35`) call `updateFullName`/`updateInterests`/`updateGeneralConfig`
**unawaited and uncaught**, then immediately `onNext()`. The store actions are async
(`common/action.ts:54,59`) but the steps ignore the promise; a failed server persist is silent
and the value lost while the flow advances. (Optimistic store softens display, not durability.)

**⑦ Within-step draft not persisted across reload — ux Edit §2.1** 🟡 Typed name (FullName) and
custom interest (Interests) live in local `useState`, committed only on Next. Step-level resume
works (server `currentStep`), but a reload mid-step drops unsent input.

**⑧ Onboarding step-sync failures are swallowed — ux Feedback §4.2** 🟡
`internal_processStepUpdateQueue` catches the server write with `console.error` only
(`onboarding/action.ts:91-93`). If step persistence keeps failing the resume point silently
won't advance and the user is never told (low: self-heals on the next step).

**⑨ ComposioServerList fetch has no loading/error surface — ux Read §1.1 / Feedback §4.2** 🟡
`useFetchUserComposioConnections(true)` drives per-app connection status but the grid always
renders the static `COMPOSIO_APP_TYPES` (`ComposioServerList/index.tsx:14-37`); a failed
connections fetch silently shows every integration as unconnected — "load failed" reads as
"nothing connected." Not a dead-end (optional step). (pending L2 for per-item render.)

**⑩ Agent conversation subtree fails to a blank — ux Feedback §4.2** 🟡 The conversation is
wrapped in `<ErrorBoundary fallbackRender={() => null}>` (`Agent/index.tsx:372`), so a throw in
the chat subtree renders **nothing** — no error, no retry. The larger per-turn failure surface
is the cost the Agent flow pays for its richness; it deserves a visible error + recovery (or to
reuse the bootstrap-error → Classic degrade path, which is the ✅ 亮点 sibling above). Surfaced
during the Agent-vs-Classic comparison.

## 4 — Skill feedback

The 回灌 loop has two halves — a gap sharpens a checklist item's ❌ example, a good case sharpens
its ✅ one. Both landed from this run:

- **New ❌ rule landed:** **Grow §5.2 — Multi-step flows show progress and stay skippable.** A
  stepwise flow (>2 steps) must (a) show a **progress / step indicator** (position + total) and
  (b) make **non-essential steps skippable** with an always-visible escape hatch; mirrored into
  the SKILL.md Quick review. ❌ examples: onboarding gaps ③ + ⑤ (the module's only `<Steps>` are
  decorative, `current={null}`).
- **Existing rule strengthened + new ✅ example landed:** **Feedback §4.2** now also covers an
  _awaited_ gating write — it must reset its in-progress flag in a `finally` and offer retry on
  catch, or a failed write permanently disables the advance control. ❌ example: gap ①. ✅ example:
  the desktop `LoginStep` state machine with retry + cancel (§2 亮点) — the positive model the
  checklist now cites.
- **Validated existing rules** (fresh ❌ examples to cite): §4.2 (②④⑥⑧⑨⑩), §3.5 (②⑥),
  Edit §2.1 (⑦), Read §1.1 error-as-empty (⑨), Escape Hatch (⑤).
- **Methodology 回灌 (from the follow-up comparison):** the Agent-vs-Classic question drove a new
  **ux-audit ground rule** — "comparing two variants: the winner is an outcome verdict, not a
  craft verdict" (+ an A/B-winner row in the coverage matrix), citing this module's own miss as
  the ❌ self-example.

## 5 — Pending: L2 visual + L3 dynamic

- **L2** — confirm no progress indicator renders (③); confirm each step's primary button is the
  dominant control (pending-L2 across all steps); AgentPicker empty vs error vs loading actually
  render distinctly (④); ComposioServerList per-item connection/error render (⑨); dark + narrow.
- **L3** — force offline on the ResponseLanguage `setSettings` write to **confirm the stuck step
  live** (①); force `installMarketplaceAgents` to reject and confirm the silent finish (②); force
  AgentPicker template load failure and confirm no-retry dead-end (④); walk classic end-to-end to
  confirm forward momentum + no skip (⑤); measure step-transition INP / CLS.

## 6 — Land the findings (queue)

Landed as **LOBE-11138** ("Onboarding UX Audit", container under the UX-audit parent
**LOBE-11078**), split into the sub-issues below. Class-norm gaps (③⑤) also 回灌 'd into `ux`
Grow §5.2; the awaited-write rule (①) into Feedback §4.2 — see §4.

| Sub-issue      | Finding(s)                                                                   | Kind       |
| -------------- | ---------------------------------------------------------------------------- | ---------- |
| **LOBE-11154** | ① language-gate stuck step (add `finally` + retry)                           | bug 🔴     |
| **LOBE-11155** | ②④ AgentPicker: install-fail silent finish + load-fail no retry              | bug 🔴     |
| **LOBE-11156** | ③ progress / Sequence Map absent                                             | bug + 回灌 |
| **LOBE-11157** | ⑤ mandatory FullName / no escape hatch                                       | bug + 回灌 |
| **LOBE-11158** | ⑥⑦⑧⑨ fire-and-forget writes / draft-loss / silent step-sync / composio state | bug 🟡     |
| _unfiled_      | ⑩ Agent conversation `ErrorBoundary` → blank (fold into LOBE-11155 or new)   | bug 🟡     |
