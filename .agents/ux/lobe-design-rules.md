# Project design rules

## LOBE-UX-001 — Verify reference alignment structurally

When aligning a Channel member picker with CPC, compare the rendered structure and interactions in both creation and the header's single “Invite members” entry (people and Agents together in workspace Channels): searchable available members on the left; selected members on the right with a one-line summary of where each runs. Device/directory fields appear only when an Agent cannot run without a choice (see LOBE-UX-011). Functional creation success alone does not prove visual alignment. Capture the configured-member state, a member that needs a directory, the search empty state, and a narrower viewport.

Source: user correction during Channel PR #21545 acceptance (2026-10-24); revised by review feedback on acceptance round 4 (2026-10-26).

## LOBE-UX-002 — Carry Agent execution choices into Channel setup

When adding an Agent to a Channel, initialize the channel-local device and same-device working directory from the Agent's effective configuration. Do not ask for an already configured value again. Preserve explicit channel edits across refreshes; never replace an offline or inaccessible binding with another machine. Block submission with an actionable member-level reason when a coding Agent lacks an online device or directory. For coding Agents, list only device choices; “Choose a device” is a placeholder, never a selectable empty option. Native Agents retain an explicit “No device” choice.

Enforcement: `src/features/Channels/CreateChannel/agentEnvironment.test.ts` covers inherited defaults, device-scoped directories, explicit overrides, presence and required fields. `useChannelAgentDraft.test.ts` exercises empty Select events (`undefined` / `null` / empty string): clear both the channel-local device and directory, preserve that override after refresh, and keep coding-Agent device requirements. The Channel member form uses these shared initialization and validation functions.

Source: user correction during local Channel collaboration testing (2026-10-26).

## LOBE-UX-003 — Size stepped dialogs for the current task (superseded)

Superseded by LOBE-UX-011: Channel creation is now a single member-first dialog, so there is no compact naming step to size. The general principle still holds for other stepped dialogs: a short step should not inherit the width of a later two-pane step.

Source: user correction that the Channel name dialog was unnecessarily wide (2026-10-26).

## LOBE-UX-004 — Personal Channel headers omit the implicit owner

The Channel header shows active Agents in personal scope; human member avatars and their popovers appear only for workspace-owned Channels. Use the Channel's own workspace identity, not member count or the currently selected navigation scope. This is a presentation filter, not a change to membership, permissions, or message attribution.

Enforcement: `src/features/Channels/visibleMembers.test.ts` covers both scopes, a single workspace person, inactive members, and preservation of membership.

Source: user correction during personal Channel testing (2026-10-26).

## LOBE-UX-005 — Channel deletion is a complete lifecycle action

Channel row menus and context menus expose deletion to the channel owner/admin. Confirm the named target and consequences before mutating. Archive rather than erase active execution records, revoke publication across all branches, and request physical stop without prematurely releasing directory locks. Remove every cached view after success and leave only the deleted channel's active route; failure keeps a retryable confirmation and restores the row. Backend scope and membership checks are authoritative.

Enforcement: Channel repository `__tests__/remove.test.ts`, `src/store/channel/action.remove.test.ts`, and `src/features/Channels/useRemoveChannel.test.ts`.

Source: user correction comparing the missing deletion flow with CPC (2026-10-26).

## LOBE-UX-006 — Distinguish Channel startup from blocked work

Independent Channel Agents start concurrently. Preserve per-member ordering and physical directory exclusivity; a slow startup or recovery must not serialize unrelated Agents. A newly queued job is presented as preparing, not as waiting behind another Agent. Actual blocking states name the reason, including an earlier reply by the same Agent.

Enforcement: `ChannelCoordinator.advance.test.ts` covers concurrent startup, bounded fan-out, per-member recovery order and failure isolation; Channel execution integration tests cover member/directory locks; `src/features/Channels/jobStatus.test.ts` covers preparing versus blocked labels.

Source: user correction of misleading Channel queue labels and sequential startup (2026-10-26).

## LOBE-UX-007 — Opening a Channel branch is not a write

Opening a branch shows a local preview of its root and default participants. Do not persist a thread or add a sidebar row until the user sends the first message. Create/reuse the thread and send that message in one channel-locked transaction, preserving request-key idempotency. Failed sends retain the draft; late responses must not reopen a closed preview or navigate away from a different selection or identity.

Enforcement: repository `__tests__/threadSend.test.ts` covers atomicity, retries and scope; `useThreadPanel.test.ts` covers local open/close and delayed completions; `src/store/channel/action.send.test.ts` covers sidebar/detail refresh after success.

Source: user correction of empty threads created merely by opening the branch panel (2026-10-26).

## LOBE-UX-008 — Channel reply progress follows live state, above the composer

Present pre-reply receipt as “Agent 接收消息中…” rather than exposing responder selection. Once a job starts, show the named Agent's reply status instead of retaining the receipt label until completion. Progress lives on one line above the composer (“锦妍・正在回复…”, “A 和 B 正在回复…”, “3 位成员正在回复…”), like a chat app's typing line, not as chips under each message; one click lists each reply with its state and a stop action. Publish claimed/blocked states independently of slow runtime startup and other members. The mounted view must reactively accelerate refresh for pending receipt, queued/running jobs and unconfirmed stops even without gateway notifications, then slow down after settlement. Keep refresh scoped to the displayed branch.

Enforcement: the reactive Channel selector and replica sync schedule are covered by `src/store/channel/action.polling.test.ts`, including an idle view becoming active after send. `ChannelCoordinator.advance.test.ts` guards notification before runtime startup settles. `jobStatus.test.ts` covers which jobs count as activity.

Source: user correction of hidden Pi reply progress and implementation-facing receipt copy (2026-10-26); moved above the composer after acceptance round 4 review (2026-10-26).

## LOBE-UX-009 — Channel self identity uses the personal avatar

Render the signed-in author's Channel messages, thread roots, @ suggestions and workspace member header with the same `UserAvatar` component as the personal identity header. Do not choose a separate emoji default or prefer a stale message-profile avatar over the live personal profile. Match both human actor type and the current user ID; never borrow the viewer's avatar for another member, a deleted user, or an Agent.

Enforcement: `ChannelMessage.tsx` and the shared `MemberAvatar.tsx` reuse `UserAvatar`; `memberName.test.ts` checks author and member identity isolation, and the existing `UserAvatar.test.tsx` checks profile-picture updates. Mention menus and member headers consume `MemberAvatar`, not a second avatar-source policy.

Source: user correction that the Channel message must use their personal avatar directly, rather than a separate fallback (2026-10-26).

## LOBE-UX-010 — Center whole-conversation failures in their own content region

A Channel or thread with no readable content uses the shared page-level error state, centered horizontally and vertically in the remaining conversation area below its header. Do not render it as a top-left widget. A thread failure stays inside its own panel; background refresh and action errors remain inline with readable content.

Enforcement: `ChannelConversation.tsx` selects `AsyncBoundary`'s `page` error variant for both hosts. Browser geometry checks compare the error content center with the owning conversation bounds; the proving environment must load the real layout CSS.

Source: user correction of the Channel load-failure layout in acceptance screenshots (2026-10-26).

## LOBE-UX-011 — Create a Channel by choosing members first

Creating a Channel works like starting a group chat: one dialog opens on the member picker; the name is optional and defaults to the members' names (“锦妍、Codex、Pi”, more than three summarized). Owners and admins rename from the sidebar menu. The header has one “Invite members” action, not separate add-person and add-Agent buttons; in workspace Channels its picker lists workspace members and Agents under one search and adds both in one submit. Each selected Agent shows where it runs as one muted line taken from its own settings; device and directory fields appear only when the Agent cannot run without them. Changing an Agent's channel-local environment happens later, from the member popover, and applies to later replies only.

Enforcement: `CreateChannel/channelTitle.test.ts` covers the generated name; repository `__tests__/channelSettings.test.ts` and `src/store/channel/action.rename.test.ts` cover rename permissions and optimistic rollback; `ChannelService.environment.test.ts` covers environment validation.

Source: acceptance round 4 review — “先拉人再改名”, “为什么要在这里选目录” (2026-10-26).

## LOBE-UX-012 — Failures belong to the header, with a marker on the message

A failed reply does not keep a chip under its message. The header shows an error indicator with the count of each Agent's unresolved failure (its newest job failed); the Agent's status dot turns red. The popover gives the reason, a jump to the message and Open Agent. The message keeps only a text-less red dot that opens the same reason. A newer reply, stop or retry from that Agent settles the header entry.

Enforcement: `jobStatus.test.ts` covers unresolved failures and the member status fallback.

Source: acceptance round 4 review — “回执错误应该放到右上角” (2026-10-26).

## LOBE-UX-013 — Channel timeline reads like a chat app

The composer is one row (attach, input, send) that grows with its content. Mentioned members render as chips in sent messages; the viewer cannot mention themself. Hovering a message highlights its row and shows a toolbar with a labelled “Start thread” action. The main timeline starts with who joined (“你邀请了 … 加入频道”), and later additions appear in time order; the generic empty state is only for a Channel with neither. The tab shows the Channel's name.

Enforcement: `mentionMarkdown.test.ts` covers mention chips (boundaries, code); `joinEvents.test.ts` covers join grouping, inviter attribution and paging.

Source: acceptance round 4 review — Discord comparisons for composer, typing line and threads (2026-10-26).

## LOBE-UX-014 — Pair each invited member’s avatar with their name

Channel join events identify people and Agents using their own avatars, not a generic invitation icon. Render each avatar beside its member name, including every member in a grouped event. Let member pairs wrap at narrow widths; do not detach the avatar stack from the names or silently omit later avatars. A member’s emoji avatar is identity, even when it resembles a warning symbol.

Source: user clarification during acceptance round 6 (2026-10-27).
