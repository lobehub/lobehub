# Worked example — Channel (bot/messenger 接入) audit

A real run of this skill against the per-agent channel-connect surface
(`/agent/:aid/channel` → `src/routes/(main)/agent/channel`), 2026-07-02 (LOBE-11216, under the
Chat / 会话 UX-Audit parent LOBE-11145). Use it as a **template for the output shape**, not as
current-state truth (the code moves; re-verify before citing).

Surface = a **master-detail settings console** for connecting one agent to messaging
platforms (Telegram / Discord / Slack / Feishu / LINE / WeChat / QQ / iMessage …). **Chrome**
\= `NavHeader`. **Left** (`list.tsx`, 260px) = a platform list with per-platform runtime
status dots, a `MessengerPromo` card, a docs link, and an overflow menu (export / import /
delete-all). **Right** = either `detail/` (a schema-driven credential + settings form →
Header status toggle, Body form, Footer save/test/delete + webhook URL) or `ComingSoon` for
not-yet-available platforms. Connecting is a **save → auto-connect → poll runtime status**
flow; WeChat uses a QR-scan modal instead of a token form.

**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic) ⏳ not
yet run — see §5. Verdicts about the render (which of the Footer's two primary buttons
actually dominates, whether the coming-soon-only degrade reads as "broken") are L1 inferences,
pending L2.

**Surface class & its norms (benchmark first).** This is an **integration / connect-an-app
console** — reference class: Slack app-directory connect, Zapier/Make connections, the
Vercel/GitHub integrations pages, Twilio senders. Class norms an L1 read should check
present/missing: per-connection **live status** (connected / failed / starting) ✅; a
**save → connecting → connected/failed** state machine ✅; **test connection** ✅; **secret
fields masked** ✅; a failed **list fetch** distinguished from "nothing connected" ✗; **typed
secrets protected** across navigation ✗; **secret export** treated as sensitive ⚠️; a
**coming-soon / request-integration** affordance that isn't a dead-end ⚠️. The defining risk
of this class is that a connection's **credentials and live status** are both load-bearing and
both fail-prone — the surface must never make "failed to load" look like "not connected / lost
your config".

## 1 — Patterns in use

| Pattern (family)                                 | Where                                                                                             | Rating | Note                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Two-Panel / Master-Detail (layout)               | list `aside` + detail `main` (`list.tsx:258`, `detail/index.tsx:500`)                             | ✅     | canonical settings shape                                                  |
| List with status (data)                          | platform rows + per-status color/title dots (`list.tsx:207-296`)                                  | ✅     | live runtime status surfaced per row                                      |
| Form Builder / schema form (edit)                | `Body` renders credential + settings from `platformDef.schema` (`Body.tsx:380-517`)               | ✅     | password fields masked, conditional `visibleWhen`, object-list allowlists |
| Save → in-progress → done (act)                  | `handleSave` → saving(locked) → auto-connect → poll (`detail/index.tsx:299-374`)                  | ✅     | textbook state machine (highlight §2)                                     |
| Optimistic toggle (act)                          | enable Switch: `pendingEnabled` + `toggleLoading`, rollback on catch (`detail/index.tsx:452-471`) | ✅     | optimistic + rollback + toast                                             |
| Live status polling (data)                       | queued/starting → poll 2s (`detail/index.tsx:183-191`); WeChat QR poll (`QrCodeAuth.tsx:51-90`)   | ✅     | QR has terminal `expired` + Refresh (highlight §2)                        |
| Capability guardrail (feedback)                  | `userIdMissing` Alert + auto-expand settings to the field (`Footer.tsx:203`, `Body.tsx:404-411`)  | ✅     | proactive + routes to the fix                                             |
| Result / Alert feedback (act)                    | save / connect / test `Alert`s (`Footer.tsx:166-201`)                                             | ✅     | each async result has a distinct alert                                    |
| Confirm destructive (act)                        | delete-one + delete-all `confirmModal` (`detail/index.tsx:436`, `list.tsx:164`)                   | ⚠️     | confirmed, but delete-all is wide-blast w/ no type-to-confirm (gap ⑤)     |
| Cross-surface promo (grow)                       | `MessengerPromo` → `/settings/messenger` (`MessengerPromo.tsx:75`)                                | ✅     | versioned-dismiss, links onward                                           |
| Failure + Retry on the **list** fetch (feedback) | —                                                                                                 | —      | **absent** — both list fetches read only `{data,isLoading}` (gap ①)       |
| Draft safety on the credential form (edit)       | —                                                                                                 | —      | **absent** — in-memory antd form, reset on switch (gap ②)                 |
| Empty / dead-end (coming-soon)                   | `ComingSoon` icon+title+desc                                                                      | ⚠️     | no CTA — dead-ends (gap ⑧)                                                |

**Read:** the **detail** half of this surface is genuinely mature — the save/connect/poll
machine, the optimistic toggle, the QR terminal-error, and the userId guardrail are all
best-in-class and are the "don't regress" core. The weakness clusters at the **seams**: the
**list fetch has no failure path** (gap ①, the one 🔴), the **credential form loses typed
secrets** on a master-detail switch (gap ②), and **secret export/import** is handled casually
(gap ③).

## 2 — Strengths / good cases (don't regress)

- **✅ 亮点 — The detail save→connect→poll state machine (→ ✅ for ux Act §3.1).**
  `handleSave` (`detail/index.tsx:299-374`): `validateFields → setSaving(locked) →
create/updateBotProvider → post-save side-effect hook → success Alert (auto-clears 3s) →
auto-`connectCurrentBot` → poll runtime status`; every async handler
  (`connectCurrentBot`, `handleToggleEnable`, `handleDelete`, `handleTestConnection`,
  `handleRefreshStatus`) has a `try/catch` that surfaces the error as a typed `Alert` or a
  toast, and each locks its own control (`saving` / `connecting` / `testing` / `toggleLoading`
  / `refreshingStatus`). This is the confirm→in-progress(locked)→done/error shape in full — the
  reference the list-side bulk paths (gap ③) should copy.
- **✅ 亮点 — Optimistic enable-toggle with rollback (→ reinforces ux Act "optimistic surfaces
  failure").** The Header Switch sets `pendingEnabled` + `toggleLoading`, writes, and on
  `catch` **reverts `pendingEnabled` and toasts** (`detail/index.tsx:452-471`) — never a silent
  optimistic rollback.
- **✅ 亮点 — WeChat QR is a correct polling flow with a terminal error + Retry (→ ✅ for ux
  Feedback §4.2).** `startQrFlow` polls scan status every 2s and handles all three terminals:
  `confirmed` → authenticate + close, `expired` → **stop polling + warning Alert + a Refresh
  button that restarts the flow** (`QrCodeAuth.tsx:60-90,120-127`). A polling loop that can
  actually _end in failure and offer a way out_ — exactly Feedback §4.2 on the live-status path.
  (Nit: it uses antd `Spin` — gap ⑦.)
- **✅ 亮点 — `userIdMissing` is a proactive guardrail that also routes to the fix.** When a
  saved bot lacks the operator User ID (needed for push-back), the Footer raises an info Alert
  (`Footer.tsx:203-211`) **and** `Body` auto-expands the collapsed Settings group to that field
  on mount (`Body.tsx:404-411,481`). A reminder that also puts the user on the field — capability
  guardrail done well (Feedback §4.3 shape).
- **✅ good — Per-status list dots with color + title** (`list.tsx:207-296`): connected /
  failed / queued / starting / dormant / disconnected each map to a distinct color and a
  hover title — the live state is legible at the list level, not just in the detail.
- **✅ good — MessengerPromo** (`MessengerPromo.tsx`): a dismissible cross-surface card whose
  dismiss id is **versioned** (`messenger-promo-v1`) so a copy change re-surfaces it, and it
  links onward to `/settings/messenger` — closed-loop discovery.

## 3 — Experience gaps (ranked)

**① A failed list fetch renders a coming-soon-only catalog / "no channels" with no error —
ux Read §1.1 / Feedback §4.2** 🔴 `useFetchPlatformDefinitions` and `useFetchBotProviders`
both return a full `SWRResponse` (with `.error`) but the page destructures only
`{ data, isLoading }` (`index.tsx:37-42`), and **both fetches set `fallbackData: []`**
(`store/agent/slices/bot/action.ts:122,130`). So on failure `error` is set-but-unread and
`data` falls back to `[]`:

- A failed **platform-definitions** fetch → `platforms = []` → `allPlatforms` = just the
  frontend-only `COMING_SOON_PLATFORMS` (`index.tsx:62-68`) → `!isLoading &&
allPlatforms.length > 0` is **true** → the surface renders a **coming-soon-only** list, with
  every real and connected platform gone, no reason, no retry.
- A failed **providers** fetch → `providers = []` → connected channels lose their status dots
  and `currentConfig`, so a configured WeChat/Slack bot reads as **never connected**; clicking
  it shows the blank "connect" form, inviting a **duplicate** re-entry of credentials.

The merged static fallback makes this worse than the usual `data ?? [] → <Empty>`: even a
`length === 0 → empty` guard wouldn't fire, because the coming-soon entries keep
`length > 0` — the failure hides behind a **plausible partial catalog**. Remedy: read `error`
from both hooks; render a failed state (reason + retry via `mutate`) before assembling
`allPlatforms`; don't let `fallbackData: []` stand in for a resolved-empty.

**② The credential form silently discards unsaved secrets on a platform switch — ux Edit
§2.1** 🟠 The detail form is an in-memory antd `Form` (`detail/index.tsx:77`); switching the
active platform in the master list runs `form.resetFields()` (`detail/index.tsx:245-251`) with
**no dirty-guard**, and nothing persists the draft. So pasting a bot token + app secret and
then clicking another platform (or navigating away, or reloading) **wipes the entered
credentials with no warning** — and these are exactly the high-effort, easy-to-lose values
(tokens copied from a third-party console) the draft-safety rule exists to protect. It's the
master-detail form of §2.1's "switching items away from a dirty editor never silently
discards", against an in-memory store. Remedy: warn on switch/exit when the form is dirty (or
back the draft to storage keyed by `agentId+platform`), matching the chat composer's per-context
draft model.

**③ Channel config export/import handles plaintext secrets casually + partial-import on
failure — ux Act (secret handling / partial failure)** 🟠 "Export config" writes **every
provider's `credentials`** (bot tokens, signing secrets) to a plaintext JSON download
`lobehub-channels-<agentId>.json` (`list.tsx:98-102`) with **no warning** the file contains
cleartext secrets and no re-mask — a store of secrets that were entered as masked
`FormPassword` fields is re-revealed in bulk to a file. And "Import config" loops
`createBotProvider` (+ optional `connectBot`) over the file (`list.tsx:127-159`); a mid-loop
throw shows a generic `importFailed` toast **after** some providers were already created —
partial import, no report of what landed or how to finish. Remedy: warn that the export
contains secrets (or encrypt/redact it); make import report per-item success/failure rather
than a single generic catch.

**④ The Footer has two primary buttons (delete + save) — ux Act (one primary button)** 🟡 The
action bar renders **Delete** as `type="primary"` + `danger` (`Footer.tsx:131-139`) alongside
**Save** as `type="primary"` (`Footer.tsx:154-162`) — two visually dominant primary controls on
one surface, so the destructive action competes with the affirmative one for the eye. Save is
the surface's single primary; delete should be a secondary / text-danger button. (Actual visual
dominance is an **L2** confirm.) Remedy: demote delete to non-primary danger.

**⑤ "Delete all channels" is a wide-blast action with only a text confirm — ux Act
(unrecoverable action)** 🟡 `handleDeleteAll` (`list.tsx:161-178`) deletes **every** channel on
the agent behind a `confirmModal` with a danger button + description — but no **explicit
gesture** (type-to-confirm / checkbox). Wiping all bot connections is unrecoverable and
wide-blast; the count-less text confirm is one misclick from destroying every integration.
(It's tucked in an overflow menu, which lowers accident odds but doesn't change the blast
radius.) Remedy: require a type-to-confirm gesture for the all-channels wipe.

**⑥ The detail defaults to the first platform, not a connected one — ux Read §1.6** 🟡
`effectiveActiveId = activeProviderId || allPlatforms[0]?.id` (`index.tsx:71`) lands on
whatever platform is first in the list, ignoring which platforms the agent has actually
**connected**. A user with only WeChat connected opens on (say) Telegram's blank form instead
of their live WeChat channel — the landing doesn't reflect the data state. Remedy: default to
the first **connected** provider when one exists, else the first platform.

**⑦ WeChat QR modal uses antd `Spin` + antd primitives — ux Feedback §4.1** 🟡 `QrCodeAuth`
loads the QR with `<Spin size="large"/>` and builds the whole modal from antd
`Button`/`Alert`/`QRCode`/`Typography` (`QrCodeAuth.tsx:5,114`), against §4.1's "no antd `Spin`;
use `NeuralNetworkLoading` / project loaders". The flow's logic is right (gap-free polling) —
only the loading visual is off-system. Remedy: swap `Spin` for a project loader.

**⑧ ComingSoon detail dead-ends — ux Read §1.1 (empty as a real page) / Grow §5.3** 🟡
`ComingSoon` renders an icon + title + description with **no next action** — no "notify me when
this ships", no "request / vote", no link to a roadmap or the channels docs
(`ComingSoon.tsx:68-83`). A placeholder that leads nowhere; the class norm (a
request-integration affordance) is absent. Remedy: add a notify/vote CTA or a docs/roadmap link.

## 4 — Skill feedback (回灌)

- **New generalizable gap → landed in `ux` Read §1.1 (mandatory close).** Every existing §1.1
  ❌ was either `data ?? [] → <Empty>` (list) or `?? {…:0}` (metrics). This surface reveals a
  **third mask: a list assembled from a fetched set _merged with a static/frontend set_**
  (`[...fetched, ...COMING_SOON]`). A failed fetch here doesn't even read as empty — the static
  entries keep `length > 0`, so both a `length === 0 → Empty` guard **and** an error-unread call
  site render a **plausible partial catalog**, hiding the entire fetched half. Landed by
  extending Read §1.1 (new paragraph + ❌ **Channel** example + a checklist line) and mirroring
  one line into the SKILL Quick review, citing `channel/index.tsx:37-42,62-68` +
  `bot/action.ts:122,130`.
- **New generalizable gap → landed in `ux` Edit §2.1.** §2.1's examples are all a **single**
  editor (the chat composer). This surface adds the **master-detail** shape: a shared form
  instance `resetFields()` on the active-item change silently discards unsaved input — and the
  input is **secrets** pasted from a third-party console (highest-effort, least-recreatable).
  Landed as a sharpened §2.1 ❌ (master-detail shared-form reset) + a Quick-review touch, with
  **Channel** as the ❌, citing `channel/detail/index.tsx:77,245-251`.
- **Validated existing rules** (good ❌ instances to cite): Read §1.1 (gap ①), Read §1.6 (gap
  ⑥, first-tab default), Act one-primary-button (gap ④), Act unrecoverable-action (gap ⑤,
  delete-all no type-to-confirm), Feedback §4.1 (gap ⑦, antd `Spin`), Act secret-handling (gap
  ③, plaintext export).
- **Good cases worth citing as ✅:** the save→connect→poll machine (§2) and the WeChat QR
  terminal-error+Refresh (§2) are strong ✅ examples for Act §3.1 and Feedback §4.2
  respectively; the `userIdMissing` guardrail-that-routes-to-the-field is a nice Feedback §4.3
  shape. Noted as ✅ examples; the rules already state the principle, so not grafted into the
  prose beyond a citation.

## 5 — Pending: L2 visual + L3 dynamic

L1-only; verdicts a later pass should confirm or quantify:

- **L2 (visual)** — does the coming-soon-only degrade (gap ①) actually read as a broken/empty
  surface? Which of the Footer's two primary buttons (gap ④) visually dominates? Does the
  260px list truncate long platform names / status dots; dark/light on the status colors; the
  QR modal's `Spin` vs the rest of the product's loaders (gap ⑦).
- **L3 (dynamic)** —
  - Force the platform-definitions fetch offline to **confirm gap ① live** — that the surface
    settles on coming-soon-only with no error, and force the providers fetch to fail to confirm
    connected channels vanish.
  - Type credentials, switch platform, and confirm the field wipes with no warning (**gap ②**).
  - Drive the full save → connect → poll happy path and a forced connect failure to confirm the
    machine's error Alerts render (protect §2).
  - Walk the WeChat QR to `expired` to confirm the Refresh restart, and to `confirmed` to
    confirm auth+close.
  - Export a config and confirm the JSON carries plaintext secrets (**gap ③**).
