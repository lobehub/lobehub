import { HETERO_CONTINUE_PROMPT, LOADING_FLAT } from '@lobechat/const';

import { isHeterogeneousAgentStatusGuideError } from '@/features/Conversation/Error/heterogeneous';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { selectRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';

import { type Store as ConversationStore } from '../../action';
import {
  ensureEffectiveAgencyAccess,
  getEffectiveAgencyConfig,
  resolveHeteroRunContext,
  runHeterogeneousFromExistingMessage,
  settleGenerationEntry,
} from './heteroRun';

/**
 * Resume a heterogeneous (CC / Codex) run whose LAST step died on a status
 * error, keeping every step that succeeded before it. See
 * `GenerationAction.continueHeteroAfterError`.
 */
export const continueHeteroAfterError = async (
  get: () => ConversationStore,
  groupMessageId: string,
) => {
  const { context, dbMessages, displayMessages, hooks } = get();
  const chatStore = useChatStore.getState();

  const group = displayMessages.find((m) => m.id === groupMessageId);
  const erroredStep = group?.children?.at(-1);
  if (!erroredStep) return;

  // Only the dedicated hetero status errors (rate limit, upstream overload,
  // auth, missing CLI) mean "the run died but its session survives". A generic
  // tool/provider error on a grouped reply is not resumable this way.
  if (!isHeterogeneousAgentStatusGuideError(erroredStep.error?.body)) return;

  await ensureEffectiveAgencyAccess(context.agentId);
  const { agencyConfig, isWorkspaceAgent, workspaceScoped } = getEffectiveAgencyConfig(
    context.agentId,
    context.topicId
      ? topicSelectors.getTopicById(context.topicId)(useChatStore.getState())
      : undefined,
  );
  const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
  const runtimeType = selectRuntimeType({
    boundDeviceId: agencyConfig?.boundDeviceId,
    executionTarget: agencyConfig?.executionTarget,
    heterogeneousProvider,
    isGatewayMode: chatStore.isGatewayModeEnabled(context.agentId),
    isWorkspaceAgent,
    workspaceScoped,
  });
  const agentId = context.agentId;
  const topic = context.topicId
    ? topicSelectors.getTopicById(context.topicId)(useChatStore.getState())
    : undefined;

  // In-process runs resolve the resumable session against this desktop's cwd.
  // A device/sandbox run (`gateway`) resolves it on the server against the
  // executing device — the same path the scheduled rate-limit resume takes —
  // so here it only matters that the topic has a session at all.
  const hasResumableSession =
    runtimeType === 'hetero'
      ? !!agentId && !!resolveHeteroRunContext(chatStore, context, agentId).resumeSessionId
      : runtimeType === 'gateway' && !!topic?.metadata?.heteroSessionId;

  // Nothing to continue from: the failed step IS the group's head (the run
  // died before producing a second step, so no work was preserved anyway), or
  // the topic has no CLI session left to resume (never started, or its cwd
  // moved). Both degrade to replacing the whole turn.
  const hasEarlierSteps = erroredStep.id !== groupMessageId;
  if (!heterogeneousProvider || !hasEarlierSteps || !hasResumableSession) {
    await get().delAndRegenerateMessage(groupMessageId);
    return;
  }

  // A step that streamed content or landed tool calls before dying is worth
  // keeping: clear its error and chain the continuation onto it. A step that
  // carries nothing but the error (its content echo was suppressed) would
  // render as an empty block, so drop it and chain onto its parent instead.
  const hasSalvageableWork =
    !!erroredStep.tools?.length || (!!erroredStep.content && erroredStep.content !== LOADING_FLAT);

  const continueParentId = hasSalvageableWork
    ? erroredStep.id
    : dbMessages.find((m) => m.id === erroredStep.id)?.parentId;
  if (!continueParentId) {
    await get().delAndRegenerateMessage(groupMessageId);
    return;
  }

  const { operationId } = chatStore.startOperation({
    context: { ...context, messageId: groupMessageId },
    type: 'regenerate',
  });

  try {
    if (hasSalvageableWork) await get().updateMessageError(erroredStep.id, null);
    else await get().deleteAssistantMessage(erroredStep.id);

    // Chaining off the run's tail (not off the user message) keeps the new
    // steps inside the same assistantGroup, so the bubble grows instead of
    // being replaced.
    if (runtimeType === 'gateway') {
      // `parentMessageId` makes the server resume the existing chain and the
      // device's CLI session instead of starting a fresh user turn. Forwarding
      // the wrapper op lets the gateway settle it at the phase-1 handoff and
      // wire its abort signal — otherwise a socket that drops before
      // `onComplete` leaves the turn stuck in `regenerate` and blocks retry.
      await chatStore.executeGatewayAgent({
        context,
        message: HETERO_CONTINUE_PROMPT,
        onComplete: () =>
          settleGenerationEntry(chatStore, operationId, () =>
            hooks.onRegenerateComplete?.(groupMessageId),
          ),
        parentMessageId: continueParentId,
        parentOperationId: operationId,
      });
      return;
    }

    await runHeterogeneousFromExistingMessage(chatStore, {
      context,
      heterogeneousProvider,
      parentMessageId: continueParentId,
      parentOperationId: operationId,
      prompt: HETERO_CONTINUE_PROMPT,
    });

    settleGenerationEntry(chatStore, operationId, () =>
      hooks.onRegenerateComplete?.(groupMessageId),
    );
  } catch (error) {
    // Settle the wrapper op on failure — see delAndRegenerateMessage.
    chatStore.failOperation(operationId, {
      message: error instanceof Error ? error.message : String(error),
      type: 'RegenerateError',
    });
    throw error;
  }
};
