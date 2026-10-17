import { isDesktop } from '@lobechat/const';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { t } from 'i18next';

import { LOADING_FLAT } from '@/const/message';
import type { AgentRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import { snapshotTopicWorkingDirGit } from '@/store/chat/slices/agentRun/actions/lifecycle/snapshotWorkingDirGit';
import type { ChatStore } from '@/store/chat/store';
import { notifyDesktopAgentCompleted } from '@/store/chat/utils/desktopNotification';
import {
  hasCompletedAssistantText,
  isAudioOnlyFirstUserMessage,
} from '@/store/chat/utils/topicTitle';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { messageMapKey } from '../../../../utils/messageMapKey';
import { displayMessageSelectors } from '../../../message/selectors/displayMessage';
import { topicSelectors } from '../../../topic/selectors';
import { scheduleQueuedFollowUp } from './queuedFollowUp';
import type {
  AgentRunLifecycle,
  RunCompleteEvent,
  RunCompleteResult,
  RunParkedEvent,
  RunResumedEvent,
  RunScope,
  UserMessagePersistedEvent,
} from './types';

const log = debug('lobe-store:run-lifecycle');

/** The effective terminal disposition a run ended on, transport-agnostic. */
type TerminalDisposition = 'cancelled' | 'failed' | 'success';

/**
 * Resolve the terminal disposition from the normalized cross-runtime `status`
 * that gateway / hetero supply. This lets `completeRun` drive the same store/UI
 * side effects regardless of which transport reached the terminal boundary.
 *
 * `cancelled` completes the operation (the cancel reaches this boundary with
 * the op still `running`, so it must be moved to a terminal state here).
 * `undefined` never completes — it means the transport reached an
 * unrecognized status and falls through untouched.
 */
const resolveTerminalDisposition = (
  event: Pick<RunCompleteEvent, 'status'>,
): TerminalDisposition | undefined => {
  const { status } = event;
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return undefined;
};

/**
 * Per-run context resolved at the dispatch seam (or, transitionally, inside the
 * executor). Carries everything the lifecycle hooks need beyond the per-call
 * event so they can be assembled ONCE and called at runtime boundaries.
 */
export interface RunAdapterContext {
  context: ConversationContext;
  parentMessageId: string;
  parentMessageType: 'user' | 'assistant' | 'tool';
  runId: string;
  runScope: RunScope;
  runtimeType: AgentRuntimeType;
}

const NOOP = async () => {};

/**
 * Assemble the store/UI run-lifecycle hooks for a single run.
 *
 * Shared by the gateway and hetero transports. `completeRun` handles only TERMINAL states;
 * parked states route to `onRunParked` and fire no terminal side effects — a
 * run is not complete while it is parked — parked states are non-terminal and
 * must not emit terminal side effects (title, queue drain, notification, unread).
 */
export const buildRunLifecycle = (
  get: () => ChatStore,
  adapter: RunAdapterContext,
): AgentRunLifecycle => {
  const { context } = adapter;
  const { agentId, topicId, groupId, workspaceSlug } = context;
  const messageKey = messageMapKey(context);
  const contextKey = messageKey;
  let voiceTopicTitleSummaryRequested = false;

  const summarizeVoiceTopicTitleAfterCompletion = () => {
    if (voiceTopicTitleSummaryRequested || adapter.runScope === 'sub_agent' || !topicId) return;

    const topic = topicSelectors.getTopicById(topicId)(get());
    const messages = displayMessageSelectors.getDisplayMessagesByKey(messageKey)(get());
    const isUntitled =
      !topic?.title ||
      topic.title === LOADING_FLAT ||
      topic.title === t('defaultTitle', { ns: 'topic' });

    if (
      topic &&
      isUntitled &&
      isAudioOnlyFirstUserMessage(messages) &&
      hasCompletedAssistantText(messages)
    ) {
      voiceTopicTitleSummaryRequested = true;
      void get()
        .summaryTopicTitle(topicId, messages)
        .catch((error) => {
          voiceTopicTitleSummaryRequested = false;
          log('Failed to summarize voice topic title: %O', error);
        });
    }
  };

  return {
    afterUserMessagePersisted: async (event: UserMessagePersistedEvent) => {
      // Topic title auto-generation. Single home for all three runtimes —
      // the client used to do this inline in sendMessage and gateway/hetero
      // had no LLM-summarized title at all before the unified lifecycle.
      // Top-level only — a nested sub-agent / `/compact` run must not retitle the
      // user's topic. See RunScope.
      if (adapter.runScope !== 'top_level') return;
      const { isCreateNewTopic, topicId, assistantMessageId } = event;
      if (!topicId) return;

      // Snapshot the working directory's live branch + linked PR onto the topic.
      // Anchored HERE (send) rather than in the ControlBar's mount effect so that
      // merely opening a topic never re-stamps its historical branch/PR. Slow gh
      // leg → fire-and-forget; it only patches topic metadata, idempotently.
      void snapshotTopicWorkingDirGit(get, { agentId, topicId }).catch(() => {});

      // Dev-only fast path: slice the first user message instead of calling the
      // LLM. Only honored in non-production builds. Relocated verbatim.
      const shouldSliceTopicTitle =
        __DEV__ && process.env.NEXT_PUBLIC_DEV_DISABLE_AUTO_TOPIC === '1';

      const applyTopicTitle = async (tid: string, messages: UIChatMessage[]) => {
        if (!shouldSliceTopicTitle) {
          await get().summaryTopicTitle(tid, messages);
          return;
        }
        const firstUserText = messages.find((m) => m.role === 'user')?.content?.trim() ?? '';
        const title = markdownToTxt(firstUserText).slice(0, 80) || 'New Topic';
        // `internal_updateTopic` already balances its own loading owner. For a
        // new client-runtime topic like "阅读下面...", an extra `false` here would
        // consume the runtime's loading owner and hide the sidebar spinner early.
        await get().internal_updateTopic(tid, { title });
        console.info('[dev] sliced topic title (NEXT_PUBLIC_DEV_DISABLE_AUTO_TOPIC=1):', title);
      };

      // Key off the EVENT's context, not the adapter's send-time `context`.
      // `context` (= operationContext captured at dispatch) still carries a null
      // topicId for a just-created topic, so its key points at the empty
      // main-scope bucket; gateway/hetero persist the conversation under the real
      // topicId (`event.context` — `{ ...operationContext, topicId }`). Reading
      // the stale key summarizes nothing and emits a degenerate "空对话标题"
      // title. `event.context` also carries groupId/threadId, so group topics
      // keep reading their real messages (the #16289 fix).
      const readStoreChats = () =>
        displayMessageSelectors.getDisplayMessagesByKey(messageMapKey(event.context))(get());

      // New topic → always title. Use caller-provided messages when present
      // (client's freshly-created rows aren't in the store under topicId yet);
      // otherwise read the persisted conversation from the store (gateway/hetero).
      if (isCreateNewTopic) {
        // The gateway path adds the new topic via a FIRE-AND-FORGET refreshTopic
        // (gateway.ts), so it may not be in the store yet — and `summaryTopicTitle`
        // bails on a missing topic. Load it first when absent (client / hetero
        // already inserted it synchronously, so this is a no-op for them).
        if (!topicSelectors.getTopicById(topicId)(get())) {
          await get()
            .refreshTopic()
            .catch(() => {});
        }
        await applyTopicTitle(topicId, event.messages ?? readStoreChats());
        return;
      }

      // Existing topic → title only when it still has none. Read from the store,
      // excluding the just-created assistant placeholder.
      const topic = topicSelectors.getTopicById(topicId)(get());
      if (topic && !topic.title) {
        const chats = readStoreChats().filter((item) => item.id !== assistantMessageId);
        await applyTopicTitle(topicId, chats);
      }
    },
    afterRunComplete: async (event: RunCompleteEvent) => {
      if (get().operations[event.operationId]?.metadata.terminalReconciled) return;
      if (adapter.runScope === 'sub_agent' || resolveTerminalDisposition(event) !== 'success')
        return;

      // A voice-only first message cannot be summarized at the post-persist seam:
      // its content is empty and the assistant row is still a loading placeholder.
      // Once the reply completes, use the now-textual conversation to generate a
      // meaningful title. This also leaves the visible default title intact if the
      // title request fails instead of turning the sidebar row blank.
      summarizeVoiceTopicTitleAfterCompletion();

      // Desktop notification + dock badge. Single home for all runtimes'
      // completion notification — every transport funnels through the shared
      // `notifyDesktopAgentCompleted` helper, so title (topic/agent name), body
      // (the actual reply) and click-to-deep-link stay identical across them.
      // Top-level-only: a nested sub-agent finishing is not a user-facing run
      // completion — the parent run is still going, so it must not fire a
      // "generation finished" notification / badge. See RunScope.
      if (!isDesktop) return;

      const notificationContext = { agentId, groupId, topicId, workspaceSlug };

      // The body content is executor-resolved (hetero's
      // in-memory `accContent`) when supplied, else derived from the store's
      // final assistant content (gateway, after its terminal DB reconciliation).
      // Dock badge is set so a backgrounded app still signals completion.
      const fallbackContent = (
        get().messagesMap?.[messageKey] ||
        get().dbMessagesMap?.[messageKey] ||
        []
      ).findLast((m) => m.role === 'assistant')?.content;

      await notifyDesktopAgentCompleted(get, {
        badge: true,
        content: event.notification?.content || fallbackContent,
        context: notificationContext,
      });
    },
    beforeRunComplete: NOOP,
    completeRun: async (event: RunCompleteEvent): Promise<RunCompleteResult> => {
      const { operationId } = event;
      if (get().operations[operationId]?.metadata.terminalReconciled) return { requeued: false };
      // Effective terminal disposition, resolved from the normalized `status`
      // gateway/hetero pass — so the same side effects fire regardless of which
      // transport reached this boundary.
      const disposition = resolveTerminalDisposition(event);

      // Title recovery is a successful-completion side effect, not a notification
      // side effect. Run it before the queued-message early return so a follow-up
      // cannot strand an audio-first topic without a title.
      if (disposition === 'success') summarizeVoiceTopicTitleAfterCompletion();

      const completeSuccess = () => {
        get().completeOperation(operationId);
        const completedOp = get().operations[operationId];
        if (completedOp?.context.agentId) {
          get().markTopicUnread({
            agentId: completedOp.context.agentId,
            groupId: completedOp.context.groupId,
            topicId: completedOp.context.topicId,
          });
        }
      };

      // 1. On success with queued messages: drain, complete, and re-trigger a new
      //    sendMessage. Only drain on success — on error the queue is preserved.
      //    Gated to TOP-LEVEL runs only: the input queue belongs to the parent
      //    run, so a nested sub-agent completion must never drain it (it would
      //    re-trigger the user's queued message mid-parent-run). See RunScope.
      if (
        disposition === 'success' &&
        adapter.runScope !== 'sub_agent' &&
        (get().queuedMessages?.[contextKey]?.length ?? 0) > 0
      ) {
        completeSuccess();

        scheduleQueuedFollowUp(get, context, operationId);

        return { requeued: true };
      }

      // 2. Complete the operation based on the terminal disposition.
      switch (disposition) {
        case 'success': {
          completeSuccess();
          break;
        }
        case 'failed': {
          get().failOperation(operationId, {
            type: 'runtime_error',
            message: 'Agent runtime execution failed',
          });
          break;
        }
        case 'cancelled': {
          // Gateway / hetero reach this boundary with the op still `running`
          // (their interrupt ends the run segment server- / CLI-side), so the op
          // must be moved to terminal here.
          get().completeOperation(operationId);
          break;
        }
        // `undefined`: unrecognized terminal status — fall through untouched.
        // Parked states never reach `completeRun` — the executor routes them to
        // `onRunParked`.
      }

      return { requeued: false };
    },
    onRunError: NOOP,
    onRunParked: async ({ operationId, reason }: RunParkedEvent) => {
      // Parked is NOT terminal: fire NO terminal side effects (title / queue
      // drain / notification / markUnread) and emit NO `client.runtime.complete`
      // — the run has not ended, it is waiting out-of-band.
      //
      // - `waiting_for_human`: complete this operation so the loading spinner
      //   clears for the approval UI; a NEW operation resumes the run when the
      //   user approves / rejects / submits / skips.
      // - `waiting_for_async_tool`: keep the operation running until the async
      //   tool / sub-agent result resolves and drives the run forward.
      if (reason === 'waiting_for_human') {
        get().completeOperation(operationId);
      }
    },
    onRunResumed: async ({ operationId, resumedOperationId, runId }: RunResumedEvent) => {
      // A NEW operation resumes the SAME logical run after a park
      // (`waiting_for_human` → approve / reject / reject-continue / submit / skip).
      // This is the single broadcast seam for that transition: it fires NO terminal
      // side effects (the run is continuing, not completing) and mutates NO store
      // state — the resume operation is already started by its entry. Behavior-
      // neutral today; the structural marker is what `[6]` AgentRunner builds on to
      // thread a stable cross-operation `runId`. Top-level only, mirroring the other
      // run-scoped hooks (a parked sub-agent is not a user-facing resume).
      if (adapter.runScope === 'sub_agent') return;
      log(
        'run resumed (parkedOp=%s → resumeOp=%s, runId=%s)',
        operationId,
        resumedOperationId,
        runId,
      );
    },
    onRunStarted: NOOP,
    onTerminalPersisted: NOOP,
  };
};
