# Worked example — Chat（会话主界面，默认无选中 topic 态）surface audit

对 agent chat 默认态（无选中 topic 的新会话）做 **L1 静态审计**。
Linear: LOBE-11221（隶属 LOBE-11145）。2026-07-02。

**Layers run:** L1 (static /code) ✅ — 以下全部。L2 (visual) / L3 (dynamic) ⏳ 未跑。
关于渲染的结论（send error 后 editor 是否可恢复、skeleton 是否永久化）是 L1 推理，待 L2/L3 确认。

Surface = 消息流（load → empty/welcome → list）+ 输入区域（`MainChatInput` → `ChatInput`）+ chrome。
本 audit 聚焦**默认态**（新会话 / 无 topic），与 \[1] topic 共享 element。

## 1 — Patterns in use

| Pattern (family)                  | Where                                                                                                      | Rating | Note                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| Center Stage (layout)             | `ConversationArea.tsx:106-135`: ChatList 主导，composer 固定在 footer                                      | ✅     | textbook                                                   |
| Visual Framework (layout)         | `agent/index.tsx:12-25`: Flexbox 100% height/width + `ChatHydration` + `TelemetryNotification`             | ✅     | consistent chrome                                          |
| Skeleton loading (feedback)       | `ChatList/index.tsx:174` — `!messagesInit && !isNewConversation` → `SkeletonList`                          | ⚠️     | **no terminal failure path** — see gap ①                   |
| Empty-state as onboarding         | `ChatList/index.tsx:178`: `AgentHome` (agent info + opening questions) 当 `displayMessageIds.length === 0` | ✅     | real page with CTA；但 welcome 无 loading state — gap ④    |
| Draft safety (input / edit)       | `useChatInputDraft` → `draftStorage.ts`: localStorage, **per-context key**, debounce 500ms, LRU 50         | ✅     | **亮点** — 见 §2                                           |
| Same-page error (feedback)        | send error → closable `Alert` (`ChatInput/index.tsx:392-400`)                                              | ✅     | 不 silent — 但 editor 已 cleared，draft 已 removed — gap ② |
| Prominent "Done" Button (action)  | Send button + mode selector + model switch (`MainChatInput/index.tsx:34-38`)                               | ✅     | primary action 明确                                        |
| Autocompletion (input)            | `@`-mention, slash menu, local-folder mention (desktop) (`Conversation/index.tsx:26-38`)                   | ✅     | rich input affordances                                     |
| Progress / Cancelability (action) | streaming 时 Stop button (`ChatInput/index.tsx:376-377`, `onStop=stopGenerating`)                          | ✅     | generation-class cancel norm met                           |
| Capability guardrail (feedback)   | `AgentConfigError` above composer (`MainChatInput/index.tsx:46`)                                           | ✅     | reactive config warning                                    |
| Capability guardrail (feedback)   | `InputCompletionErrorAlert` — model completion 不可用时 `ChatInput/index.tsx:77-99`                        | ✅     | soft warning + settings link                               |
| Update Indicator (data)           | `RefreshingHint` when SWR isValidating (`ChatList/index.tsx:155-156`)                                      | ✅     | non-destructive refresh indicator                          |
| Virtualized list (data)           | `VirtualizedList` over `displayMessageIds` (`ChatList/index.tsx:196-201`)                                  | ✅     | scales to long conversations                               |
| Overview + Detail (data)          | message → Portal / WorkingSidebar                                                                          | ✅     | preserves surface contract (panel)                         |

## 2 — Strengths / good cases（don't regress）

- **✅ 亮点 — Durable, per-context composer draft。** Composer 对每个 topic 的输入做 localStorage 持久化，
  **按 context key**（agent+topic+thread）做 scope。每次击键 debounce 保存（500ms），mount 时 restore 到空 editor，
  unmount 时 flush pending save，send 后 remove draft（`draftStorage.ts`、`useChatInputDraft.ts`、`ChatInput/store/action.ts:85`）。
  Storage 上限 50 条 LRU eviction（`draftStorage.ts:108-126`）。reload /crash/ 切 topic **不会丢失输入**，
  且 draft 不跨 topic 泄漏。这是 Edit §2.1 ❌ 的反面 —— **已经是 Edit §2.1 ✅ 示例**。

- **✅ 亮点 — Send failure is surfaced, not silent。** 失败的 send 在 composer 上方渲染 closable `Alert`
  携带 `sendMessageError` 信息（`ChatInput/index.tsx:392-400`）。不像 Pages sidebar 只有 `console.error`，
  用户明确知道发送失败了。

- **✅ 亮点 — Streaming is abortable。** 生成中的 Stop 按钮连到 `stopGenerating`
  (`ChatInput:376-377`)，满足 generation-class "Cancel while it runs" norm（Act §3.1）。

- **✅ 亮点 — Deep-linking two-way sync。** `ChatHydration` 做 URL ↔ store 双向同步：
  `useLayoutEffect` 把 `:topicId` / `?thread=` 注入 store，`subscribe` 把 store 变化写回 URL
  用 `replace` history（`ChatHydration/index.tsx:32-85`）。

- **✅ 亮点 — Auto-reconnect to running Gateway operation。** `useGatewayReconnect` 在 topic load
  时检测并重连运行中的 operation（`ConversationArea.tsx:84-88`）。用户刷新页面不丢失进行中的 agent run。

- **✅ 亮点 — Stream-safe message refresh。** `useFetchMessages` 在读 stream 时 gated：
  `isAgentRuntimeRunning` → skip onData write，避免 SWR refetch 覆盖内存中 stream 内容
  (`data/action.ts:226-235`)。

- **✅ Send error cleared on next successful send。** `conversationLifecycle.ts` 在每次 sendMessage
  启动时 `inputSendErrorMsg: undefined`，不和 stale error 混合。

## 3 — Experience gaps（ranked）

---

### ① 🔴 Message stream 无 terminal failure path — fetch error → permanent skeleton — Feedback §4.2 / Read §1.1

**文件**: `src/features/Conversation/ChatList/index.tsx:174`

ChatList 用 `messagesInit` 做 loading gate：

```tsx
if (!messagesInit && !isNewConversation) {
  return <SkeletonList />;
}
```

`messagesInit` 是 **success-only / data-presence-disguised init flag**：

- `useFetchMessages` 只注册了 `onData`，**没有 `onError`**（`data/action.ts:211-266`）
- `messagesInit: true` **只在 onData 中设置**（`data/action.ts:258`），或由 `StoreUpdater`
  从 `hasInitMessages` 初始化（`StoreUpdater.tsx:72`）
- fetch 失败时 `messagesInit` 永远为 false → `SkeletonList` 永久渲染，**无 Retry**

`hasInitMessages` 从 ChatStore 的 `dbMessagesMap[chatKey]` 来（`ConversationArea.tsx:52`）。
如果该 topic 有 cached messages（上次访问过的），`messagesInit` 起始即为 true，skeleton 不出现，
问题仅发生在**无缓存 topic** 的首次 fetch 失败。

**SWR `error` property 完全未被消费** — `messagesSWR` 只读了 `.isValidating`。

**影响**: 切到一个有消息的 topic 后断网 → 永久 skeleton，唯一的恢复方式是 navigate away + reload。
这属于 Feedback §4.2 描述的经典模式："init flag set only on success → permanent skeleton on error"。

**修复建议**: ChatList 或 ConversationArea 消费 `messagesSWR.error`，在非空时渲染 Error/Retry 态
带 Reload 按钮（调用 `messagesSWR.mutate()`）。

---

### ② 🔴 Send 先清 editor + 删 draft，再异步 send — send 失败时 editor 为空且 draft 被删除 — Edit §2.1

**文件**:

- `src/features/Conversation/ChatInput/index.tsx:342-343` — `clearContent()` 先于 `await sendMessage()`
- `src/features/ChatInput/store/action.ts:85` — `removeDraft(draftKey)` 在 store 层同样先于实际发送完成

时序：

1. `handleSend` 捕获 markdown/json → 立即 `clearContent()` → 编辑器为空
2. 同时 `handleSendButton`（store 层）在 `onSend` 回调后立即 `addInputHistory` + `removeDraft(draftKey)`
3. `await sendMessage(...)` 异步执行
4. 如果 ChatStore 的 sendMessage 在创建 user message 之前抛异常 → editor 为空 + draft 已删除 + 无 user message

虽然 ChatStore 的 `sendMessage` 在 `conversationLifecycle.ts` 中有自己的 try-catch 设置
`inputSendErrorMsg`，但 send error 的 alert（`ChatInput:392-400`）只提供了 **close** 按钮 —
没有 "retry with same content" 的路径。用户必须重新输入。

**对比**: `inputHistoryStorage` 在 `handleSendButton` 中**同步**写入（send 之后，但在 store action 内部），
所以如果 ChatStore catch 了 error 但已经过了 `addInputHistory` 那行，则历史里有一份。但 draft 已经删除，
editor 为空，用户得手动从 history 找回。且 `addInputHistory` 依赖 `handleSendButton` 的成功路径 —
如果 `onSend` 里的 `clearContent` 和 `addInputHistory` 之间有 race（虽然目前同步），风险依然存在。

**修复建议**:

- draft removal 推迟到 send 确认成功（user message created）之后
- 或 send error 路径恢复 draft（`saveDraft(draftKey, capturedJson)`）
- 或在 send error alert 上提供 "retry" action（恢复 editor content 并重新 send）

---

### ③ 🟠 ChatInput 的 `sendMessageError` alert — closable 但无可操作用 Retry — Act §3.1

**文件**: `src/features/Conversation/ChatInput/index.tsx:392-400`

```tsx
<Alert
  closable
  title={t('input.errorMsg', { errorMsg: sendMessageErrorMsg })}
  type={'secondary'}
  onClose={clearSendMessageError}
/>
```

send error alert 只有一个 close 操作（dismiss the alert），没有 Retry/resend 操作。
这违反了 Act §3.1 的 terminal error 规则：error 状态应该带 escape hatch。
在这个 context 里，escape hatch = resend。

**修复建议**: alert 的 action 区域加一个 "Retry" button，调用恢复 editor content + 重新 send。

---

### ④ 🟡 AgentHome（welcome）无 loading state — agent config 异步加载时 welcome 显示 blank/partial

**文件**: `src/features/AgentHome/index.tsx`

AgentHome 渲染时依赖 agent config：

- `AgentInfo` 读取 `agentSelectors.currentAgentMeta` — agent name/avatar/description
- `OpeningQuestions` 读取 `agentSelectors.openingQuestions`

`ChatList/index.tsx:119-123` 在 mount 时调用 `useFetchAgentConfig(isLogin, context.agentId)` 确保
agent config 已加载，但这是 fire-and-forget SWR — 没有 loading/error 状态。
在 config 加载完成前，AgentInfo 可能显示空白（agent title 为空）、OpeningQuestions 为 `[]`。

这不算 critical（chat 的 welcome 本来就是一个 greeting page），但属于 Consistency 缺口：
new-conversation 的 welcome page 看起来像 loaded but empty，而不是 still-loading。

**修复建议**: AgentInfo 在 agent title 为空时渲染 skeleton avatar + title placeholder；
OpeningQuestions 列表渲染 skeleton chips。

---

### ⑤ 🟢 Discussion — 发送进行中的 editor 行为是 feature，不是 bug

当前设计允许用户在 streaming 期间继续编辑并 queue 消息（`disableQueue` 仅在 onboarding 等 surface 设为 true）。
Queue 通过 `QueueTray` 可见，这是一个 pattern 实现：**Deferred Choices (feedback)**。
这与 ChatGPT/Claude 的行为一致，是正确的设计选择。无需修改。

## 4 — 回灌 ux skill

### ✅ Draft safety (Edit §2.1) — 已有 ✅ 示例，不需新增

chat 的 `useChatInputDraft` + `draftStorage` 已经是 Edit §2.1 引用的 ✅ 示例（`edit.md:18-20`）。
无需回灌。

### Gap ① → Feedback §4.2 强化 ❌ 示例

**现有**: Feedback §4.2 的 ❌ 示例是 Agent profile (`agentConfigErrorMap` orphaned)。

**新增**: 在 Feedback §4.2 添加 chat ChatList 的 ❌ 示例：

> ❌ **Chat ChatList** (`src/features/Conversation/ChatList/index.tsx:174`) has zero error branch —
> `messagesInit` is a data-presence-disguised init flag set only inside SWR `onData` (`data/action.ts:258`),
> and the SWR `error` property is never consumed. A failed fetch on a topic with no cached messages
> renders a permanent `SkeletonList` with no Retry — Fix: consume `messagesSWR.error`, render a failed
> state with `messagesSWR.mutate()` as the Retry action.

### Gap ② → Edit §2.1 强化 ❌ 示例 — send 失败丢失 editor content

**新增**: 在 Edit §2.1 的 "Failed save keeps content for retry" checklist 下添加：

> ❌ **Chat ChatInput** (`src/features/Conversation/ChatInput/index.tsx:342, store/action.ts:85`)
> clears the editor (`clearContent()`) and removes the localStorage draft (`removeDraft(draftKey)`)
> **before** `await sendMessage()` completes — a send failure leaves the editor empty and the draft
> deleted, with no recovery path. The send-error alert shows only a close button, not a Retry that
> restores the captured content. Fix: defer draft removal to post-success, or on error restore the
> draft from the captured JSON + show a Retry action.

## 5 — Layers pending

- **L2 (visual)**: confirm skeleton renders correctly on real topic load; confirm AgentHome welcome
  renders as real page (not blank); verify send error alert visual hierarchy; dark mode.
- **L3 (dynamic)**: drive send failure + retry flow; force message fetch error via network throttle;
  measure CLS during topic switch; verify keyboard focus after send / stop.
