import type { AgentState } from '@lobechat/agent-runtime';
import { isDesktop } from '@lobechat/const';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import debug from 'debug';

import type { AgentRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';
import { notifyDesktopAgentCompleted } from '@/store/chat/utils/desktopNotification';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { messageMapKey } from '../../../../utils/messageMapKey';
import { displayMessageSelectors } from '../../../message/selectors/displayMessage';
import type { OperationStatus } from '../../../operation/types';
import { mergeQueuedMessages, reconstructUploadFilesFromQueue } from '../../../operation/types';
import { topicSelectors } from '../../../topic/selectors';
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

/**
 * Normalize the runtime/operation status into the cross-runtime
 * `client.runtime.complete` signal status.
 *
 * Only TERMINAL states reach here: parked states (`waiting_for_human` /
 * `waiting_for_async_tool`) are routed to `onRunParked` by the executor and
 * never emit a completion signal — a run is not complete while it is parked.
 */
const normalizeClientRuntimeCompleteStatus = (
  runtimeStatus: AgentState['status'] | undefined,
  operationStatus?: OperationStatus,
): 'cancelled' | 'completed' | 'failed' | undefined => {
  if (operationStatus === 'cancelled') return 'cancelled';
  if (operationStatus === 'failed') return 'failed';
  if (operationStatus === 'completed') return 'completed';
  if (runtimeStatus === 'done') return 'completed';
  if (runtimeStatus === 'error' || runtimeStatus === 'interrupted') return 'failed';
  return undefined;
};

/** The effective terminal disposition a run ended on, transport-agnostic. */
type TerminalDisposition = 'cancelled' | 'failed' | 'success';

/**
 * Resolve the terminal disposition from EITHER the client's raw `runtimeStatus`
 * (`AgentState['status']`) OR the normalized cross-runtime `status` that gateway
 * / hetero supply. This lets `completeRun` drive the same store/UI side effects
 * regardless of which transport reached the terminal boundary.
 *
 * `cancelled` completes the operation for gateway/hetero (their cancel reaches
 * this boundary with the op still `running`, so it must be moved to a terminal
 * state here) but NOT for the client (its cancel path already moved the op out
 * of band before reaching `completeRun`). `undefined` never completes — it means
 * the transport reached an unrecognized status and falls through untouched.
 */
const resolveTerminalDisposition = (
  event: Pick<RunCompleteEvent, 'runtimeStatus' | 'status'>,
): TerminalDisposition | undefined => {
  const { runtimeStatus, status } = event;
  // Client drives off the raw runtime status.
  if (runtimeStatus === 'done') return 'success';
  if (runtimeStatus === 'error') return 'failed';
  if (runtimeStatus === 'interrupted') return 'cancelled';
  // Gateway / hetero drive off the normalized terminal status.
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return undefined;
};

const findCompletionAssistantMessageId = (
  messages: UIChatMessage[],
  parentMessageId: string,
  parentMessageType: 'user' | 'assistant' | 'tool',
) => {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const parentMessage = messagesById.get(parentMessageId);
  const isDescendantOfParent = (message: UIChatMessage) => {
    let currentParentId = message.parentId;
    const visited = new Set<string>();

    while (currentParentId && !visited.has(currentParentId)) {
      if (currentParentId === parentMessageId) return true;
      visited.add(currentParentId);
      currentParentId = messagesById.get(currentParentId)?.parentId;
    }

    return false;
  };

  return (
    messages.findLast((message) => message.role === 'assistant' && isDescendantOfParent(message))
      ?.id ??
    (parentMessageType === 'assistant' && parentMessage?.role === 'assistant'
      ? parentMessage.id
      : undefined)
  );
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
 * The hook bodies are the CLIENT completion effects (the fullest set today), to
 * be reused as the shared implementation when gateway/hetero are wired in the
 * follow-up entry convergence. `completeRun` handles only TERMINAL states;
 * parked states route to `onRunParked` and fire no terminal side effects — a
 * run is not complete while it is parked — parked states are non-terminal and
 * must not emit terminal side effects (title, queue drain, notification, unread).
 */
export const buildRunLifecycle = (
  get: () => ChatStore,
  adapter: RunAdapterContext,
): AgentRunLifecycle => {
  const { context, parentMessageId, parentMessageType } = adapter;
  const { agentId, topicId, threadId, groupId } = context;
  const messageKey = messageMapKey(context);
  const contextKey = messageKey;

  const emitComplete = (operationId: string, runtimeStatus: AgentState['status'] | undefined) => {
    // `client.runtime.complete` is a CLIENT-only source event (browser → server
    // policy pipeline). Gateway / hetero emit their own `client.gateway.*` events
    // at their transport boundaries, so the shared lifecycle must not emit it for
    // them.
    if (adapter.runtimeType !== 'client') return;
    const finalMessages = get().messagesMap[messageKey] || [];
    const assistantMessageId =
      findCompletionAssistantMessageId(finalMessages, parentMessageId, parentMessageType) ??
      findCompletionAssistantMessageId(
        get().dbMessagesMap[messageKey] || [],
        parentMessageId,
        parentMessageType,
      );
    const operationStatus = get().operations[operationId]?.status;

    void emitClientAgentSignalSourceEvent({
      payload: {
        agentId,
        ...(assistantMessageId ? { anchorMessageId: assistantMessageId } : {}),
        assistantMessageId,
        operationId,
        status: normalizeClientRuntimeCompleteStatus(runtimeStatus, operationStatus),
        threadId: threadId ?? undefined,
        topicId: topicId ?? undefined,
        ...(parentMessageType === 'user' ? { triggerMessageId: parentMessageId } : {}),
      },
      sourceId: `${operationId}:client:complete`,
      sourceType: 'client.runtime.complete',
    });
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

      const readStoreChats = () =>
        displayMessageSelectors.getDisplayMessagesByKey(messageMapKey({ agentId, topicId }))(get());

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
      // Desktop notification + dock badge. Single home for all runtimes'
      // completion notification — every transport funnels through the shared
      // `notifyDesktopAgentCompleted` helper, so title (topic/agent name), body
      // (the actual reply) and click-to-deep-link stay identical across them.
      // Top-level-only: a nested sub-agent finishing is not a user-facing run
      // completion — the parent run is still going, so it must not fire a
      // "generation finished" notification / badge. See RunScope.
      if (adapter.runScope === 'sub_agent') return;
      if (!isDesktop) return;

      const notificationContext = { agentId, groupId, topicId };

      if (adapter.runtimeType === 'client') {
        // CLIENT: notify only OUTSIDE tool-calling mode; content comes from the
        // in-memory store. No badge (preserves the prior client behavior).
        //
        // Anchor to the assistant message THIS run produced (walk from
        // parentMessageId), NOT a positional findLast on the topic. On a later
        // turn the fresh assistant can still be settling into messagesMap while
        // the previous turn's assistant is the last populated one — a naive
        // findLast then surfaces the PRIOR turn's reply as the notification body.
        // Mirror emitComplete's dual-map (messagesMap → dbMessagesMap) lookup so
        // the body is pinned to this run's freshest persisted content.
        const finalMessages = get().messagesMap[messageKey] || [];
        const dbMessages = get().dbMessagesMap[messageKey] || [];
        const assistantId =
          findCompletionAssistantMessageId(finalMessages, parentMessageId, parentMessageType) ??
          findCompletionAssistantMessageId(dbMessages, parentMessageId, parentMessageType);
        const lastAssistant = assistantId
          ? (finalMessages.find((m) => m.id === assistantId) ??
            dbMessages.find((m) => m.id === assistantId))
          : undefined;
        if (!lastAssistant?.content || lastAssistant?.tools) return;

        await notifyDesktopAgentCompleted(get, {
          content: lastAssistant.content,
          context: notificationContext,
        });
        return;
      }

      // GATEWAY / HETERO: the body content is executor-resolved (hetero's
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
      const { operationId, runtimeStatus } = event;
      // Effective terminal disposition, resolved from the client `runtimeStatus`
      // OR the normalized `status` gateway/hetero pass — so the same side effects
      // fire regardless of which transport reached this boundary.
      const disposition = resolveTerminalDisposition(event);

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

      // 1. afterCompletion callbacks — fire on ALL terminal states (tools that
      //    registered post-run actions: speak / broadcast / delegate).
      const operation = get().operations[operationId];
      const afterCompletionCallbacks = operation?.metadata?.runtimeHooks?.afterCompletionCallbacks;
      if (afterCompletionCallbacks && afterCompletionCallbacks.length > 0) {
        for (const callback of afterCompletionCallbacks) {
          try {
            await callback();
          } catch (error) {
            // Keep the original log prefix — characterization tests lock it (behavior-preserving).
            console.error('[executeClientAgent] afterCompletion callback error:', error);
          }
        }
      }

      // 2. On success with queued messages: drain, complete, and re-trigger a new
      //    sendMessage. Only drain on success — on error the queue is preserved.
      //    Gated to TOP-LEVEL runs only: the input queue belongs to the parent
      //    run, so a nested sub-agent completion must never drain it (it would
      //    re-trigger the user's queued message mid-parent-run). See RunScope.
      if (disposition === 'success' && adapter.runScope !== 'sub_agent') {
        const remainingQueued = get().drainQueuedMessages(contextKey);
        if (remainingQueued.length > 0) {
          const merged = mergeQueuedMessages(remainingQueued);

          completeSuccess();
          emitComplete(operationId, runtimeStatus);

          const execContext = { ...context };
          const mergedContent = merged.content;
          const mergedFiles =
            merged.filesPreview.length > 0
              ? reconstructUploadFilesFromQueue(merged.filesPreview)
              : merged.files.length > 0
                ? (merged.files.map((id) => ({ id })) as any)
                : undefined;

          setTimeout(() => {
            // Use the passed `get` (the live chat-store getter) rather than a
            // direct `useChatStore` import: in prod they resolve to the same
            // singleton sendMessage, and avoiding the value import keeps the chat
            // store out of this module's graph — so gateway.ts can statically
            // import buildRunLifecycle without re-entering the store mid-eval.
            get()
              .sendMessage({
                context: execContext,
                editorData: merged.editorData,
                files: mergedFiles,
                ...(merged.forceRuntime ? { forceRuntime: merged.forceRuntime } : {}),
                message: mergedContent,
                metadata: merged.metadata,
              })
              .catch((e: unknown) => {
                console.error('[executeClientAgent] sendMessage for queued content failed:', e);
              });
          }, 100);

          return { requeued: true };
        }
      }

      // 3. Complete the operation based on the terminal disposition.
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
          // must be moved to terminal here. The client is exempt: its cancel
          // path already set the op to `cancelled` out of band, and
          // `completeOperation` deliberately preserves a `cancelled` status.
          if (adapter.runtimeType !== 'client') get().completeOperation(operationId);
          break;
        }
        // `undefined`: unrecognized terminal status — fall through untouched.
        // Parked states never reach `completeRun` — the executor routes them to
        // `onRunParked`.
      }

      emitComplete(operationId, runtimeStatus);

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
