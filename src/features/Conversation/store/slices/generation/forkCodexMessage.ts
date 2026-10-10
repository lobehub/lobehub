import type { ConversationContext } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { threadService } from '@/services/thread';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { selectRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type Store as ConversationStore } from '../../action';
import {
  ensureEffectiveAgencyAccess,
  getEffectiveAgencyConfig,
  resolveHeteroRunContext,
  runHeterogeneousFromExistingMessage,
} from './action';
import { buildCodexBranchParams } from './codexBranch';

/**
 * Creates an isolated Codex branch at the selected native turn.
 *
 * Use when:
 * - Branching from a saved Codex user or assistant message.
 * Expects:
 * - A saved source message with native provenance and an idle conversation.
 * Returns:
 * - After the branch exists and, for a user message, its replayed prompt has run.
 */
export const forkCodexMessage = async (
  get: () => ConversationStore,
  messageId: string,
): Promise<void> => {
  const { context, dbMessages } = get();
  const chatStore = useChatStore.getState();
  if (operationSelectors.isInputLoadingByContext(context)(chatStore)) {
    throw new Error(t('messageAction.regenerateAlreadyRunning', { ns: 'chat' }));
  }
  const source = dbMessages.find((message) => message.id === messageId);
  if (!source) throw new Error('The selected Codex message is unavailable');
  if (!context.topicId) throw new Error('Codex branches require a saved topic');
  const topicId = context.topicId;
  const { operationId } = chatStore.startOperation({
    context: { ...context, messageId },
    type: 'regenerate',
  });
  const isRunning = () =>
    operationSelectors.getOperationById(operationId)(useChatStore.getState())?.status === 'running';

  try {
    await ensureEffectiveAgencyAccess(context.agentId);
    const topic = topicSelectors.getTopicById(topicId)(useChatStore.getState());
    const { agencyConfig, isWorkspaceAgent, workspaceScoped } = getEffectiveAgencyConfig(
      context.agentId,
      topic,
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
    if (
      (runtimeType !== 'hetero' && runtimeType !== 'gateway') ||
      heterogeneousProvider?.type !== 'codex' ||
      heterogeneousProvider.authMode === 'api'
    ) {
      throw new Error(
        'Codex message branches require a native Codex runtime on the selected device',
      );
    }
    const sourceMetadata = context.threadId
      ? useChatStore.getState().threadMaps[topicId]?.find((item) => item.id === context.threadId)
          ?.metadata
      : topic?.metadata;
    const runtime =
      runtimeType === 'hetero'
        ? resolveHeteroRunContext(useChatStore.getState(), context, context.agentId, topic)
        : {
            resumeSessionId: source.metadata?.heteroSessionId,
            workingDirectory: sourceMetadata?.workingDirectory,
          };
    if (!runtime.resumeSessionId) {
      throw new Error('The native Codex thread is unavailable on this device');
    }
    const { threadParams, messageParams } = buildCodexBranchParams({
      context,
      source,
      workingDirectory: runtime.workingDirectory,
      workingDirectoryConfig: (context.threadId
        ? useChatStore.getState().threadMaps[topicId]?.find((item) => item.id === context.threadId)
            ?.metadata
        : topic?.metadata
      )?.workingDirectoryConfig,
    });
    if (!isRunning()) return;

    toast.info(t('codexForkFilesystemNotice', { ns: 'common' }));
    const branch = messageParams
      ? // Fork-at-user replays the selected prompt without its old answer.
        await threadService.createThreadWithMessage({ ...threadParams, message: messageParams })
      : { messageId: undefined, threadId: await threadService.createThread(threadParams) };
    // NOTICE:
    // Preserve native boundaries when Desktop and server versions differ.
    // Older create schemas strip fork metadata, making forks lose context.
    // Source: `packages/types/src/topic/thread.ts` at `b6198d9b34`; updateThread accepts metadata.
    // Remove when every supported server version preserves these fields on create.
    await threadService.updateThread(branch.threadId, { metadata: threadParams.metadata });
    const threads = await threadService.getThreads(topicId);
    useChatStore.setState((state) => ({
      threadMaps: { ...state.threadMaps, [topicId]: threads },
    }));
    const branchContext: ConversationContext = {
      ...context,
      isNew: false,
      scope: 'thread',
      threadId: branch.threadId,
    };
    await chatStore.refreshMessages(branchContext);
    const latest = useChatStore.getState();
    if (
      messageMapKey(get().context) === messageMapKey(context) &&
      latest.activeTopicId === topicId &&
      latest.activeAgentId === context.agentId
    ) {
      chatStore.openThreadInPortal(branch.threadId, source.id);
    }
    if (!isRunning()) return;

    if (messageParams && branch.messageId) {
      if (runtimeType === 'gateway') {
        await useChatStore.getState().executeGatewayAgent({
          context: branchContext,
          fileIds: messageParams.files,
          message: messageParams.content,
          parentMessageId: branch.messageId,
          parentOperationId: operationId,
        });
      } else
        await runHeterogeneousFromExistingMessage(useChatStore.getState(), {
          codexForkTarget: threadParams.metadata?.codexForkTarget,
          context: branchContext,
          contextSelections: source.metadata?.contextSelections,
          heterogeneousProvider,
          imageList: source.imageList,
          pageSelections: source.metadata?.pageSelections,
          parentMessageId: branch.messageId,
          parentOperationId: operationId,
          prompt: messageParams.content,
          topic,
        });
    }
    chatStore.completeOperation(operationId);
  } catch (error) {
    chatStore.failOperation(operationId, {
      message: error instanceof Error ? error.message : String(error),
      type: 'CodexForkError',
    });
    throw error;
  }
};
