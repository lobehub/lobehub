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

## 2 — Experience gaps (ranked)

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

## 3 — Skill feedback

- **Validated existing rules** (❌ examples to cite): §4.2 (①②④⑥⑧⑨, incl. the awaited-write-
  no-`finally` permanent-disable in ①), §3.5 (②⑥), Edit §2.1 (⑦), Escape Hatch (⑤).
- **New / strengthenable `ux` items from this audit:**
  - **Multi-step / wizard flows** (new candidate, likely **Grow** or a new "Getting started"
    line): a stepwise flow must (a) show a **progress / step indicator** (position + length) and
    (b) make **non-essential steps skippable** with an always-present escape hatch. ❌ examples:
    onboarding gaps ③ + ⑤. This class norm is absent from the current checklists.
  - **Feedback §4.2 strengthen:** an _awaited_ gating write must reset its in-progress flag in a
    `finally` (and offer retry on catch), or a failed write permanently disables the advance
    control. ❌ example: onboarding gap ①.
- **Exemplar to cite the other way** (✅): desktop `LoginStep` idle/loading/success/error state
  machine with retry + cancel + progress countdown (`LoginStep.tsx`) — the reference pattern for
  Failure + Retry the web write-steps lack.

## 4 — Pending: L2 visual + L3 dynamic

- **L2** — confirm no progress indicator renders (③); confirm each step's primary button is the
  dominant control (pending-L2 across all steps); AgentPicker empty vs error vs loading actually
  render distinctly (④); ComposioServerList per-item connection/error render (⑨); dark + narrow.
- **L3** — force offline on the ResponseLanguage `setSettings` write to **confirm the stuck step
  live** (①); force `installMarketplaceAgents` to reject and confirm the silent finish (②); force
  AgentPicker template load failure and confirm no-retry dead-end (④); walk classic end-to-end to
  confirm forward momentum + no skip (⑤); measure step-transition INP / CLS.

## 5 — Land the findings (queue)

Systemic 🔴 (①②) are concrete bugs → fix or file as sub-issues under **LOBE-11078**
(container: "Onboarding UX audit" → one sub-issue per finding). Class-norm gaps (③⑤) →回灌
`ux` as the new multi-step-flow checklist item, citing onboarding as the ❌ example.

| Prio | Finding                                            | Kind       |
| ---- | -------------------------------------------------- | ---------- |
| P0   | ① language-gate stuck step (add `finally` + retry) | bug 🔴     |
| P0   | ② swallowed install failure → silent finish        | bug 🔴     |
| P1   | ③ progress/Sequence Map absent                     | bug + 回灌 |
| P1   | ④ AgentPicker error no retry                       | bug 🟠     |
| P1   | ⑤ mandatory FullName / no escape hatch             | bug + 回灌 |
| P2   | ⑥ fire-and-forget profile writes                   | bug 🟡     |
| P2   | ⑦⑧⑨ draft-loss / silent step-sync / composio state | bug 🟡     |
