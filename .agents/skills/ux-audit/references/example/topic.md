# Worked example — Topic (话题) surface audit

A real run of this skill against the desktop **topic view** — the agent chat scoped to a
selected topic: route `/agent/:aid/:topicId` → `src/routes/(main)/agent/index.tsx`
(`Conversation` + `ChatHydration`) inside `(chat)/_layout` (ChatHeader + Portal +
AgentWorkingSidebar). Linear: LOBE-11213 (under LOBE-11145). 2026-07. Use as a template for
the **output shape**, not current-state truth (the code moves; re-verify before citing).

**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic + CLS)
⏳ not run — see §5. Verdicts about the render (stale-flash on switch, whether the failed
turn's message bubble carries a retry) are L1 inferences here, pending L2/L3.

Surface = the message stream (load → empty/welcome → list), the composer (`MainChatInput` →
`ChatInput`), and the chrome (ChatHeader, Portal, WorkingSidebar). Shares its element with
\[9] chat; this run focuses the **selected-topic** state (a topic whose messages are fetched
from the server, vs the new/empty conversation).

## 1 — Patterns in use

| Pattern (family)                  | Where                                                                                | Rating      | Note                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------- |
| Center Stage (layout)             | message stream dominates; composer pinned below (`(chat)/_layout`)                   | ✅          | textbook                                                                     |
| Deep-linking (nav)                | `/:topicId` ↔ `activeTopicId`, `?thread=` ↔ `activeThreadId` (`ChatHydration:32-85`) | ✅ **亮点** | two-way URL↔store sync, replace-history — see §2                             |
| Escape Hatch (nav)                | ChatHeader topic actions (rename / export / delete), share, panel toggle             | ✅          | full lifecycle on the header                                                 |
| Overview + Detail (data)          | message → Portal (file / artifact / doc / thread), WorkingSidebar                    | ✅          | preserves surface contract (panel, not navigate)                             |
| Cards / Virtualized list (data)   | `VirtualizedList` (react-virtuoso) over `displayMessageIds` (`ChatList:196`)         | ✅ **亮点** | scales to long conversations — see §2                                        |
| Skeleton loading (feedback)       | `SkeletonList` while `!messagesInit` (`ChatList:174`)                                | ⚠️          | **no terminal failure path** — see gap ①                                     |
| Empty-state as onboarding         | `AgentHome` welcome (agent info + opening questions + recents) (`ChatList:178`)      | ✅          | real page; but same page for new-topic vs 0-msg (gap ③)                      |
| Draft safety (input / edit)       | `useChatInputDraft` → `draftStorage` localStorage, **per-topic key**                 | ✅ **亮点** | durable, per-topic, restore/flush/clear — see §2, star                       |
| Same-page error (feedback)        | send error → closable `Alert` (`ChatInput:392-400`)                                  | ✅ **亮点** | surfaced, not silent (contrast home composer) — but no in-place retry, gap ② |
| Autocompletion (input)            | `@`-mention, slash menu, local-folder mention (desktop) (`Conversation/index.tsx`)   | ✅          | rich input affordances                                                       |
| Progress / Cancelability (action) | streaming shows a **Stop** button (`ChatInput:376-377`, `onStop=stopGenerating`)     | ✅          | long-running op is abortable (generation-class norm)                         |
| Capability guardrail (feedback)   | `AgentConfigError` above the composer (`MainChatInput:46`)                           | ✅          | reactive config warning                                                      |

**Read:** the conversation surface is **mature** — the standouts below are as load-bearing as
the one gap. The only real weakness is the classic one for this codebase: **Feedback
(failure states)** — the message stream can't fail visibly.

## 2 — Strengths / good cases (don't regress)

The behaviors this surface gets **right** — the "don't regress" list for the next refactor,
and the ✅ half of the 回灌 loop. Each is evidence-backed.

- **✅ 亮点 — Durable, per-topic composer draft (the star).** The composer backs each topic's
  in-progress input to `localStorage`, **keyed per context** (`draftKey` = agent+topic+thread):
  debounced-saves on every keystroke and flushes on blur (`InputEditor/index.tsx:570,567`),
  restores into an empty editor on mount (`useChatInputDraft.ts:32-43`), flushes any pending
  save on unmount (`:30`), and **removes** the draft on send (`ChatInput/store/action.ts:85`).
  Storage caps at 50 drafts with LRU eviction (`draftStorage.ts:108-126`). _Load-bearing:_
  a reload / crash / topic-switch on the app's highest-traffic input **never vaporizes a typed
  message**, and drafts don't bleed across topics. This is the **opposite** of the in-memory
  home-composer the `ux` Edit §2.1 ❌ still cites — landed as the Edit §2.1 **✅ example**
  (`→ landed as ux Edit §2.1 ✅`).
- **✅ 亮点 — Send failure is surfaced, not silent.** A failed send renders a closable `Alert`
  carrying the error (`ChatInput/index.tsx:392-400`, `onClose=clearSendMessageError`).
  _Load-bearing:_ unlike the fire-and-forget `console.error` paths the `ux` Act §3.1 ❌ examples
  call out (Pages sidebar, Task job-control), the user is told the send failed. (The gap is
  only that the alert lacks an in-place **Retry** — see gap ②; the surfacing itself is right.)
- **✅ 亮点 — Streaming is abortable.** A running generation shows a **Stop** button wired to
  `stopGenerating` (`ChatInput:376-377`), not just a spinner. _Load-bearing:_ satisfies the
  generation-class "Cancel while it runs" norm (`ux` Act §3.1) on the core surface.
- **✅ Deep-linking is a clean two-way sync.** `ChatHydration` mirrors `:topicId`/`?thread=`
  → store via `useLayoutEffect` and store → URL via `subscribe` with `replace` history
  (`ChatHydration/index.tsx:32-85`). _Load-bearing:_ a shared/bookmarked topic URL restores
  exact state; navigation never desyncs from what's rendered.
- **✅ Message list is virtualized.** `VirtualizedList` (react-virtuoso) renders only visible
  rows over `displayMessageIds` (`ChatList:196-201`). _Load-bearing:_ a 1k-message topic stays
  responsive — the Read §1.2 "designed to scale" norm.

## 3 — Experience gaps (ranked)

**① Message stream has no terminal failure path — permanent skeleton on fetch error — ux
Feedback §4.2 / Read §1.1** 🔴 The message list gates its render on `messagesInit`
(`ChatList/index.tsx:174` → `if (!messagesInit && !isNewConversation) return <SkeletonList/>`),
which is a **success-only / data-presence-disguised init flag**:

- `useFetchMessages` registers **`onData` only, no `onError`** in both the chat store
  (`store/chat/slices/message/actions/query.ts:216-232`) and the conversation store
  (`features/Conversation/store/slices/data/action.ts:211-266`); `messagesInit` is set `true`
  **only** inside the success `onData` (`data/action.ts:258`), or via `StoreUpdater` from
  `hasInitMessages = !!messages` (`ConversationArea.tsx:95`, `StoreUpdater.tsx:73`) —
  dbMessagesMap presence, written only on success.
- The SWR object's `error` is **discarded at the call site**: `ChatList:97` keeps
  `messagesSWR` but line 157 reads only `.isValidating`; there is **no error branch** in the
  render (`174` skeleton / `178` welcome / `194` list).

⇒ When `messageService.getMessages()` errors (500 / network / auth) for a selected topic,
`messagesInit` never flips → **`SkeletonList` renders forever**, no reason, no **Reload/Retry**
— on the product's **highest-traffic surface**. Textbook §4.2 success-only-init-flag trap
(same shape already cited for Task list / Eval / Memory / generation). → **LOBE-11222**.

**② Send-error Alert has no in-place retry — ux Act §3.1 / Feedback §4.2** 🟡 The failed-send
`Alert` (§2) is closable but carries **no Retry / resend**; the editor was already cleared on
send (`ChatInput:356`). Recovery presumably lives on the failed turn's message bubble
(regenerate) — **pending L2** to confirm that bubble exists and carries a retry; if it doesn't,
this rises to 🟠.

**③ Empty-topic and new-conversation share one welcome — ux Read §1.1 (minor)** 🟡 Both "new
conversation" (`isNewConversation`, no topicId) and "loaded topic with 0 messages"
(`displayMessageIds.length === 0`) render the same `AgentHome` welcome (`ChatList:172,178`). A
genuinely-empty _existing_ topic reads identically to a brand-new one. Low impact, noted for
completeness.

## 4 — Skill feedback

- **New ✅ example landed (good-case 回灌):** the durable per-topic draft (§2 star) → added as
  the **✅ example** beside `ux` **Edit §2.1** (`references/edit.md`), the positive counterpart
  to the home-composer ❌ that rule already carries. This is the ✅ half of the loop.
- **New ❌ example landed (gap 回灌):** gap ① → added as a flagship **❌ example** under `ux`
  **Feedback §4.2** (`references/feedback.md`) — the same success-only-init-flag /
  data-presence-disguised (`messagesInit`) permanent-skeleton, now on the **core chat message
  stream**. Quick-review line already exists; no new line needed.
- **Validated existing rules (instances, not landed):** send-error-surfaced (§2) is a ✅
  instance of Act §3.1's "surface failure"; streaming Stop is a ✅ instance of Act §3.1's
  Cancel-while-running.
- **No new generalizable _rule_.** Every gap maps to an existing checklist item (§4.2, Act
  §3.1). Per the skill's close rule, stated explicitly: this run sharpened both halves of two
  existing items rather than adding a new one.
- **Stale-example note:** the Edit §2.1 **home-composer ❌** may now be out of date if home
  shares this same `ChatInput`/`draftStorage` path — flagged to verify in a separate pass, not
  touched here.

## 5 — Pending: L2 visual + L3 dynamic

- **L2 (visual)** — confirm the send button truly reads as the single dominant control;
  confirm the failed-turn message bubble renders a visible **retry** (settles gap ②); check
  whether switching topics shows a stale-message flash before the new topic's skeleton/data
  (the `dbMessagesMap[newKey]` swap) — an L2/L3 verdict, not an L1 one.
- **L3 (dynamic)** —
  - Force `getMessages` to error and **confirm gap ① live** (permanent skeleton, no retry).
  - Drive a send that fails mid-stream to confirm gap ②'s recovery path end-to-end.
  - Measure conversation CLS across the skeleton→messages swap and the streaming append.
