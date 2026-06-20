import type { AgentState } from '@lobechat/agent-runtime';
import { isDesktop } from '@lobechat/const';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { t } from 'i18next';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import type { AgentRuntimeType } from '@/store/chat/slices/aiChat/actions/agentDispatcher';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/aiChat/actions/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';
import { resolveNotificationNavigatePath } from '@/store/chat/utils/desktopNotification';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { messageMapKey } from '../../../../utils/messageMapKey';
import { topicMapKey } from '../../../../utils/topicMapKey';
import type { OperationStatus } from '../../../operation/types';
import { mergeQueuedMessages, reconstructUploadFilesFromQueue } from '../../../operation/types';
import type {
  AgentRunLifecycle,
  RunCompleteEvent,
  RunCompleteResult,
  RunParkedEvent,
  RunScope,
} from './types';

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
 * run is not complete while it is parked (see LOBE-10382).
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
    afterUserMessagePersisted: NOOP,
    afterRunComplete: async (event: RunCompleteEvent) => {
      // Desktop notification + dock badge. Single home for all three runtimes'
      // completion notification (LOBE-10379 "通知去重，统一到 afterRunComplete").
      // Top-level-only: a nested sub-agent finishing is not a user-facing run
      // completion — the parent run is still going, so it must not fire a
      // "generation finished" notification / badge. See RunScope.
      if (adapter.runScope === 'sub_agent') return;
      if (!isDesktop) return;
      try {
        const { desktopNotificationService } =
          await import('@/services/electron/desktopNotification');
        const navigatePath = resolveNotificationNavigatePath({ agentId, groupId, topicId });
        const navigate = navigatePath ? { path: navigatePath } : undefined;

        if (adapter.runtimeType === 'client') {
          // CLIENT: notify only OUTSIDE tool-calling mode; title + body derived
          // from the in-memory store. Relocated verbatim — no badge (preserves
          // the prior client behavior).
          const finalMessages = get().messagesMap[messageKey] || [];
          const lastAssistant = finalMessages.findLast((m) => m.role === 'assistant');
          if (!lastAssistant?.content || lastAssistant?.tools) return;

          let notificationTitle = t('notification.finishChatGeneration', { ns: 'electron' });
          if (topicId) {
            const key = topicMapKey({ agentId, groupId });
            const topicData = get().topicDataMap[key];
            const topic = topicData?.items?.find((item) => item.id === topicId);
            if (topic?.title) notificationTitle = topic.title;
          } else {
            const agentMeta = agentSelectors.getAgentMetaById(agentId)(getAgentStoreState());
            if (agentMeta?.title) notificationTitle = agentMeta.title;
          }

          await desktopNotificationService.showNotification({
            body: markdownToTxt(lastAssistant.content),
            navigate,
            title: notificationTitle,
          });
          return;
        }

        // GATEWAY / HETERO: the run-complete title is the generic completion
        // string; the body is executor-resolved (hetero's `accContent`) when
        // supplied, else derived from the store's final assistant content
        // (gateway, after its terminal DB reconciliation). Dock badge is set so a
        // backgrounded app still signals completion. Mirrors the prior
        // `notifyCompletion` fan-out.
        const fallbackContent = (
          get().messagesMap?.[messageKey] ||
          get().dbMessagesMap?.[messageKey] ||
          []
        ).findLast((m) => m.role === 'assistant')?.content;
        const body =
          event.notification?.body ??
          (fallbackContent
            ? markdownToTxt(fallbackContent)
            : t('notification.finishChatGeneration', { ns: 'electron' }));
        await Promise.allSettled([
          desktopNotificationService.showNotification({
            body,
            navigate,
            title:
              event.notification?.title ??
              t('notification.finishChatGeneration', { ns: 'electron' }),
          }),
          desktopNotificationService.setBadgeCount?.(1),
        ]);
      } catch (error) {
        console.error('Desktop notification error:', error);
      }
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
    onRunResumed: NOOP,
    onRunStarted: NOOP,
    onTerminalPersisted: NOOP,
  };
};
