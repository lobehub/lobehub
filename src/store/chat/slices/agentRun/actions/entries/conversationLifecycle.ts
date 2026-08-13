// Disable the auto sort key eslint rule to make the code more logic and readable
import { createCallAgentManifest } from '@lobechat/builtin-tool-agent-management';
import { GoalIdentifier, isGoalPrompt } from '@lobechat/builtin-tool-goal';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import {
  DEFAULT_MODEL,
  isDesktop,
  isHeterogeneousAgentModelId,
  LOADING_FLAT,
} from '@lobechat/const';
import { formatSelectedSkillsContext, formatSelectedToolsContext } from '@lobechat/context-engine';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { chainCompressContext } from '@lobechat/prompts';
import type {
  ChatAudioItem,
  ChatImageItem,
  ChatThreadType,
  ChatTopic,
  ChatTopicMetadata,
  ChatVideoItem,
  ConversationContext,
  MessageMetadata,
  SendMessageParams,
  SendMessageServerResponse,
  UIChatMessage,
} from '@lobechat/types';
import {
  getWorkingDirEffectivePath,
  getWorkingDirSourcePath,
  resolveAgentAgencyConfig,
} from '@lobechat/types';
import { generateEntityId, nanoid } from '@lobechat/utils';
import { toast } from '@lobehub/ui/base-ui';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';

import { type ChatInputEditor } from '@/features/ChatInput';
import {
  resolveAgentWorkingDirectory,
  resolveAgentWorkingDirectoryConfig,
} from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget, resolveWorkspaceScoped } from '@/helpers/executionTarget';
import { getAgentRuntimeMode } from '@/helpers/gatewayMode';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  activeProjectionRecord,
  getAgentProjectionById,
  getProjectionStoreState,
  nextProjectionObservedAt,
  selectChatTopicListItem,
  selectChatTopicsIndex,
} from '@/projection';
import { loadAgentConfigProjection } from '@/projection/modules/agent/queries';
import { getChatGroupProjection } from '@/projection/modules/chatGroup/read';
import { chatGroupProjectionSelectors } from '@/projection/modules/chatGroup/selectors';
import { aiAgentService } from '@/services/aiAgent';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { resolveSelectedSkillsWithContent } from '@/services/chat/mecha/skillPreload';
import { resolveSelectedToolsWithContent } from '@/services/chat/mecha/toolPreload';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { getAgentStoreState } from '@/store/agent';
import { getAgentMeta } from '@/store/agent/projection';
import { getPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { dbMessageSelectors, displayMessageSelectors } from '@/store/chat/selectors';
import { selectRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import { executeDirectMention } from '@/store/chat/slices/agentRun/actions/dispatch/directMentionExecutor';
import { buildRunLifecycle } from '@/store/chat/slices/agentRun/actions/lifecycle/buildRunLifecycle';
import type { RunScope } from '@/store/chat/slices/agentRun/actions/lifecycle/types';
import { resolveHeteroResume } from '@/store/chat/slices/agentRun/actions/transports/hetero/heteroResume';
import type { QueuedFile } from '@/store/chat/slices/operation/types';
import {
  isQueueBlockingOperation,
  mergeQueuedMessages,
  reconstructUploadFilesFromQueue,
} from '@/store/chat/slices/operation/types';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { chatPortalSelectors } from '@/store/chat/slices/portal/selectors';
import { getChatTopicById, getCurrentChatTopic } from '@/store/chat/slices/topic/projection';
import { type ChatStore } from '@/store/chat/store';
import {
  mergeAgentRuntimeInitialContexts,
  resolveActiveTopicDocumentInitialContext,
} from '@/store/chat/utils/activeTopicDocumentContext';
import {
  createPendingCompressedGroup,
  getCompressionCandidateMessageIds,
  hasRunningCompressionOperation,
} from '@/store/chat/utils/compression';
import { isLocalOnlyMessage } from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { snapshotAgentModel } from '@/store/chat/utils/snapshotAgentModel';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { getElectronStoreState } from '@/store/electron';
import { getFileStoreState } from '@/store/file/store';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/pageAgentRuntime';
import { type StoreSetter } from '@/store/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { useUserMemoryStore } from '@/store/userMemory';
import { markdownToTxt } from '@/utils/markdownToTxt';
import { aggregateSubagentMetrics } from '@/utils/subagentMetrics';

import { materializeLocalSystemToolSnapshots } from '../transports/client/localSystemToolSnapshots';
import type { CommandSendOverrides } from './commandBus';
import {
  hasNonActionContent,
  injectReferTopicNode,
  mergeLocalFileReferences,
  parseLocalFileReferencesFromEditorData,
  parseMentionedAgentsFromEditorData,
  parseSelectedSkillsFromEditorData,
  parseSelectedToolsFromEditorData,
  parseSingleAgentMentionDirectRoute,
  processCommands,
} from './commandBus';
import { resolveExistingTopicForRun } from './resolveExistingTopic';

/**
 * Extended params for sendMessage with context
 */
export interface SendMessageWithContextParams extends SendMessageParams {
  /**
   * Conversation context (required for cross-store usage)
   * Contains sessionId, topicId, and threadId
   */
  context: ConversationContext;
  /**
   * Editor owned by the calling ConversationProvider. Embedded conversations
   * must not fall back to ChatStore's global editor, which may belong to a
   * sibling panel.
   */
  inputEditor?: ChatInputEditor | null;
  /** Restore composer-owned context when sending fails before a message owns it. */
  onPreflightFailure?: () => void;
  /**
   * Called as soon as the backend reports a newly created topic id, so callers
   * with an isolated topic scope (e.g. Task Manager) can switch their UI to the
   * new topic while the AI response is still streaming.
   *
   * Only invoked when `context.isolatedTopic` is true; otherwise the store's
   * own `switchTopic` handles the transition on the global chat store.
   */
  onTopicCreated?: (topicId: string) => void | Promise<void>;
}

/**
 * Result returned from sendMessage
 */
export interface SendMessageResult {
  /** The created assistant message ID */
  assistantMessageId: string;
  /** The created thread ID (if a new thread was created) */
  createdThreadId?: string;
  /** The created topic ID (if a new topic was created in this call) */
  createdTopicId?: string;
  /** The created user message ID */
  userMessageId: string;
}

type SendMessageServerResponseMeta = SendMessageServerResponse & {
  __isPartialMessages?: boolean;
};

const toTopicTimestamp = (value: Date | number | string | undefined, fallback: number): number => {
  if (typeof value === 'number') return value;
  if (value === undefined) return fallback;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? fallback : timestamp;
};

interface OptimisticTopicPlaceholder {
  id: string;
  metadata?: ChatTopicMetadata;
  /** Pinned model snapshot — top-level `topics.model` column, not metadata. */
  model?: string;
  provider?: string;
  title: string;
}

/**
 * Actions managing the complete lifecycle of conversations including sending,
 * regenerating, and resending messages
 */

type Setter = StoreSetter<ChatStore>;
export const conversationLifecycle = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ConversationLifecycleActionImpl(set, get, _api);

const isAbortError = (error: unknown, abortController?: AbortController) =>
  !!abortController?.signal.aborted ||
  (error instanceof Error &&
    (error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('cancelled')));

const createAbortError = () =>
  Object.assign(new Error('Compression cancelled'), { name: 'AbortError' });

const throwIfSendAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;

  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Message send was cancelled', 'AbortError');
};

const attachSendTimeMetadataToUserMessage = (
  messages: UIChatMessage[],
  userMessageId: string,
  metadata: MessageMetadata | undefined,
): UIChatMessage[] => {
  if (!metadata) return messages;

  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.id !== userMessageId) return message;

    changed = true;
    return {
      ...message,
      metadata: {
        ...(message.metadata ?? undefined),
        ...metadata,
      },
    };
  });

  return changed ? nextMessages : messages;
};

const mergePartialPersistedMessages = (
  currentMessages: UIChatMessage[],
  persistedMessages: UIChatMessage[],
  replacedMessageIds: string[],
): UIChatMessage[] => {
  const replacedIdSet = new Set(replacedMessageIds);
  const persistedIdSet = new Set(persistedMessages.map((message) => message.id));

  return [
    ...currentMessages.filter(
      (message) => !replacedIdSet.has(message.id) && !persistedIdSet.has(message.id),
    ),
    ...persistedMessages,
  ];
};

export class ConversationLifecycleActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  /**
   * Read the active filter from the canonical sidebar topic index so it can be
   * forwarded to `sendMessageInServer`. Without this, the server returns
   * an unfiltered list which `internal_updateTopics` then writes back over
   * the filtered sidebar — completed/cron topics reappear until the next
   * SWR revalidation.
   */
  #getTopicFilter = (
    agentId?: string,
    groupId?: string,
  ):
    | { excludeStatuses?: string[]; excludeTriggers?: string[]; includeTriggers?: string[] }
    | undefined => {
    if (!agentId && !groupId) return undefined;
    const data = selectChatTopicsIndex(
      getProjectionStoreState().scopes[getCacheScope()],
      'sidebar',
      topicMapKey({ agentId, groupId }),
    );
    if (!data) return undefined;
    const { excludeStatuses, excludeTriggers } = data.signature;
    if (!excludeStatuses?.length && !excludeTriggers?.length) return undefined;
    return {
      ...(excludeStatuses?.length ? { excludeStatuses } : {}),
      ...(excludeTriggers?.length ? { excludeTriggers } : {}),
    };
  };

  sendMessage = async ({
    message,
    editorData: inputEditorData,
    files,
    forceRuntime,
    metadata,
    onlyAddUserMessage,
    context,
    contextSelections,
    inputEditor,
    messages: inputMessages,
    optimisticUserMessageId,
    parentId: inputParentId,
    pageSelections,
    onPreflightFailure,
    onMessageAccepted,
    onMessagePersisted,
    onTopicCreated,
    preserveComposer,
    signal,
  }: SendMessageWithContextParams): Promise<SendMessageResult | undefined> => {
    throwIfSendAborted(signal);

    let detachCallerAbort = () => {};
    let hasNotifiedMessageAccepted = false;
    const detachUnacceptedCallerAbort = () => {
      if (!hasNotifiedMessageAccepted) detachCallerAbort();
    };
    const notifyMessageAccepted = () => {
      if (hasNotifiedMessageAccepted) return;

      hasNotifiedMessageAccepted = true;
      detachCallerAbort();
      try {
        onMessageAccepted?.();
      } catch (error) {
        console.error('[sendMessage] onMessageAccepted callback failed:', error);
      }
    };
    let hasNotifiedMessagePersisted = false;
    const notifyMessagePersisted = () => {
      if (hasNotifiedMessagePersisted) return;

      notifyMessageAccepted();
      hasNotifiedMessagePersisted = true;
      try {
        onMessagePersisted?.();
      } catch (error) {
        console.error('[sendMessage] onMessagePersisted callback failed:', error);
      }
    };

    let editorData = inputEditorData;
    const { executeClientAgent, mainInputEditor } = this.#get();
    const targetInputEditor = inputEditor ?? mainInputEditor;
    const ownerAgentId = context.agentId;
    const selectedSkills = parseSelectedSkillsFromEditorData(editorData);
    const selectedTools = parseSelectedToolsFromEditorData(editorData);
    if (
      isGoalPrompt(message) &&
      !selectedTools.some(({ identifier }) => identifier === GoalIdentifier)
    ) {
      selectedTools.push({ identifier: GoalIdentifier, name: 'Goal' });
    }
    const mentionedAgents = parseMentionedAgentsFromEditorData(editorData);

    const localFileReferences = mergeLocalFileReferences(
      parseLocalFileReferencesFromEditorData(editorData),
    );

    // Use context from params (required)
    // If creating new thread (isNew + scope='thread'), threadId will be created by server
    const isCreatingNewThread = context.isNew && context.scope === 'thread';
    // Build newThread params for server from new context format
    // Only create newThread if we have both sourceMessageId and threadType
    const newThread =
      isCreatingNewThread && context.sourceMessageId && context.threadType
        ? {
            sourceMessageId: context.sourceMessageId,
            type: context.threadType as ChatThreadType,
          }
        : undefined;

    if (!ownerAgentId) {
      onPreflightFailure?.();
      return;
    }

    // A single explicit @Agent is an execution route, not a supervisor turn.
    // Keep the current conversation as the owner, but resolve runtime/config
    // from the mentioned agent so Lobe AI is never invoked for this message.
    const directMentionRoute = !context.groupId
      ? parseSingleAgentMentionDirectRoute(editorData)
      : undefined;
    const agentId = directMentionRoute?.agent.id ?? ownerAgentId;

    let agentState = getAgentStoreState();
    let agentConfig = getAgentProjectionById(agentId);
    if (directMentionRoute && !agentConfig) {
      const canonical = await loadAgentConfigProjection(agentId, getCacheScope());
      if (!canonical) throw new Error(`Mentioned agent not found: ${agentId}`);
      agentState = getAgentStoreState();
      agentConfig = getAgentProjectionById(agentId);
    }
    const agent = getAgentProjectionById(agentId);
    const currentUserId = userProfileSelectors.userId(getUserStoreState());
    const isAuthor = !!currentUserId && agent?.userId === currentUserId;
    const usesWorkspaceMemberSelection =
      !!agent?.workspaceId && agent.visibility !== 'private' && !isAuthor;
    const deviceOverride = usesWorkspaceMemberSelection
      ? getUserStoreState().workspaceUserPreference.agentDeviceOverrides?.[agentId]
      : undefined;
    const workspaceScoped = resolveWorkspaceScoped(usesWorkspaceMemberSelection, deviceOverride);
    // Runtime selection must use the same per-user device override as the
    // switcher. A workspace-local pick is intentionally private to this member
    // and is therefore safe to execute in-process on their desktop.
    const agencyConfig = resolveAgentAgencyConfig(agentConfig?.agencyConfig, deviceOverride, {
      canManage: isAuthor,
      visibility: agent?.visibility,
      workspaceId: agent?.workspaceId,
    });
    const isGatewayMode = this.#get().isGatewayModeEnabled(agentId);
    // Legacy agents may only carry `model: '<cli-type>'`. Keep gateway routing
    // unchanged when it is available, but recover the provider before the
    // desktop-only local fallback so both runtime selection and the executor
    // receive the same heterogeneous identity.
    const heterogeneousProvider =
      agencyConfig?.heterogeneousProvider ??
      (isDesktop && !isGatewayMode && isHeterogeneousAgentModelId(agentConfig?.model)
        ? { type: agentConfig.model }
        : undefined);
    const runtimeType = selectRuntimeType({
      boundDeviceId: agencyConfig?.boundDeviceId,
      executionTarget: agencyConfig?.executionTarget,
      heterogeneousProvider,
      isGatewayMode,
      isWorkspaceAgent: workspaceScoped,
      // Callers that need to pin the runtime (e.g. task topics that were
      // started server-side via runTask) pass `forceRuntime` to override
      // the agent's local/cloud preference.
      parentRuntime: forceRuntime,
    });

    // ── Command Bus: extract and process built-in commands from editorData ──
    const commandOverrides: CommandSendOverrides = processCommands({
      message,
      editorData,
      files,
      onlyAddUserMessage,
      context,
      messages: inputMessages,
      parentId: inputParentId,
      pageSelections,
      contextSelections,
    });

    // /compact — directly compress context without sending any message
    if (commandOverrides.triggerCompression) {
      const compressContext = { ...context };
      if (
        compressContext.topicId &&
        !hasRunningCompressionOperation(Object.values(this.#get().operations), compressContext)
      ) {
        await this.executeCompression(compressContext, '');
      }
      return;
    }

    // /newTopic — force a fresh topic regardless of current context
    let forceNewTopicFromExisting = false;
    if (commandOverrides.forceNewTopic) {
      const hasFile = files && files.length > 0;
      // If no message content besides the action tag and no files, just navigate to a new topic without sending
      if (!hasNonActionContent(editorData) && !hasFile) {
        await this.#get().switchTopic(null);
        return;
      }

      if (context.topicId) {
        const originalTopic = getChatTopicById(context.topicId);
        const topicTitle = originalTopic?.title || '';
        // Inject referTopic into content for LLM context
        const referTag = `<refer_topic name="${topicTitle}" id="${context.topicId}" />`;
        message = `${referTag}\n${message}`;
        // Inject refer-topic node into editorData for rich text display
        editorData = injectReferTopicNode(editorData, context.topicId, topicTitle);
        forceNewTopicFromExisting = true;
      }
      context = { ...context, topicId: undefined };
    }

    // When creating new thread, override threadId to undefined (server will create it)
    // Check if current agentId is the supervisor agent of the group
    let isGroupSupervisor = false;
    if (context.groupId) {
      const group = getChatGroupProjection(
        chatGroupProjectionSelectors.getGroupById(context.groupId),
      );
      isGroupSupervisor = group?.supervisorAgentId === agentId;
    }
    // In non-group context, @agent mentions make the current agent act as supervisor
    const hasMentionedAgents =
      !context.groupId && !directMentionRoute && mentionedAgents.length > 0;

    // Page-scoped conversations: the page editor runtime tracks the currently
    // open document. Inject its id at send time so the agent-runtime context
    // (and downstream server-side PageAgent tool calls, which only receive that
    // context) is scoped to the open document. Without this the server runtime
    // throws "received a tool call without documentId in context".
    //
    // This fallback is only authoritative when the active page's editor is
    // mounted (StoreUpdater has called setCurrentDocId for it). Callers that
    // create a document and send before that editor mounts (e.g. sendAsWrite)
    // MUST pass the new documentId in context explicitly — the `!context.documentId`
    // guard preserves it, so the singleton (still bound to the previous page) is
    // not consulted and a stale id is never injected.
    const activePageDocumentId =
      context.scope === 'page' && !context.documentId
        ? pageAgentRuntime.getCurrentDocId()
        : undefined;

    // Whether this send has to create the topic. From here on this flag — NOT
    // `!operationContext.topicId` — is the "new topic" test: the conversation
    // adopts its client-minted topic id below, so the context CARRIES a topicId
    // for a topic that does not exist on the server yet.
    const willCreateNewTopic = !context.topicId;

    /**
     * The id this send's topic will be created under, minted up front and
     * adopted by the WHOLE send: the operation context, the optimistic message
     * bucket, `activeTopicId` and the sidebar row all use it from the first
     * frame, and the server honours it verbatim (`newTopic.id` / `clientIds`).
     *
     * This removes the server-confirmation re-key: optimistic messages use the
     * final topic key immediately, so the virtualized list does not repaint from
     * an empty viewport when the server responds. The composer still pivots once
     * from `_new` to this minted key below, and its pending context is migrated
     * before that switch.
     *
     * Isolated-topic callers keep the legacy flow (they re-subscribe via
     * `onTopicCreated` and never render the main conversation surface).
     */
    const mintedTopicId =
      willCreateNewTopic && !context.isolatedTopic ? generateEntityId('topics') : undefined;

    const operationContext = {
      ...context,
      agentId: ownerAgentId,
      ...(isCreatingNewThread && { threadId: undefined }),
      // Only set the supervisor markers for actual group supervisors — NOT for
      // @agent mentions. These drive group-specific UI rendering (SupervisorMessage
      // with group avatars). orchestrationRole is the canonical field; isSupervisor
      // is kept for back-compat.
      ...(isGroupSupervisor && { isSupervisor: true, orchestrationRole: 'supervisor' as const }),
      ...(activePageDocumentId ? { documentId: activePageDocumentId } : {}),
      ...(mintedTopicId ? { topicId: mintedTopicId } : {}),
    };

    const fileIdList = files?.map((f) => f.id);
    const isLocalSystemEnabled = getAgentRuntimeMode(agentId) === 'local';
    const canMaterializeLocalFiles =
      isDesktop &&
      localFileReferences.length > 0 &&
      !metadata?.localSystemToolSnapshots?.length &&
      (!!heterogeneousProvider || isLocalSystemEnabled);
    const localSystemToolSnapshots = canMaterializeLocalFiles
      ? await materializeLocalSystemToolSnapshots(localFileReferences).catch((error) => {
          onPreflightFailure?.();
          throw error;
        })
      : [];
    const userMessageMetadata =
      metadata ||
      contextSelections?.length ||
      pageSelections?.length ||
      localSystemToolSnapshots.length
        ? {
            ...metadata,
            ...(contextSelections?.length ? { contextSelections } : undefined),
            ...(pageSelections?.length ? { pageSelections } : undefined),
            ...(localSystemToolSnapshots.length ? { localSystemToolSnapshots } : undefined),
          }
        : undefined;

    // Enrich selected skills/tools with preloaded content, injected directly
    // via SelectedSkillInjector/SelectedToolInjector — no fake tool-call preload messages
    const enrichedSelectedSkills = await resolveSelectedSkillsWithContent({
      message,
      selectedSkills,
    }).catch((error) => {
      onPreflightFailure?.();
      throw error;
    });
    const enrichedSelectedTools = resolveSelectedToolsWithContent({
      message,
      selectedTools,
    });
    const requestTrigger = (metadata as Pick<MessageMetadata, 'trigger'> | undefined)?.trigger;
    const requestMetadata = requestTrigger ? { trigger: requestTrigger } : undefined;

    throwIfSendAborted(signal);

    const hasFile = !!fileIdList && fileIdList.length > 0;

    // if message is empty or no files, then stop
    if (!message && !hasFile) {
      onPreflightFailure?.();
      return;
    }

    const newTopicTitle = markdownToTxt(message).slice(0, 80) || t('defaultTitle', { ns: 'topic' });

    // ━━━ Message Queue: enqueue if this context is already busy ━━━
    // Include the initial `sendMessage` persist/create-topic phase. Example:
    // first send from a blank chat is still creating topic A (`topicId=null`);
    // a fast second Enter must queue on `main_<agent>_new` instead of starting
    // topic B.
    const currentContextKey = messageMapKey(operationContext);
    // A new-topic send must ALSO queue behind a send that is still creating its
    // topic for this same conversation surface. That earlier send's operation is
    // registered under ITS minted topic's bucket (the context adopted the id up
    // front), so probing only this send's key would miss it — a fast second
    // Enter would start a concurrent topic instead of queueing. `creatingTopicIds`
    // names exactly those in-flight buckets.
    const queueCandidateKeys = [
      currentContextKey,
      ...(willCreateNewTopic
        ? [
            // The pre-mint `_new` key: ops that predate topic adoption (or any
            // legacy caller) still register here.
            messageMapKey({ ...operationContext, topicId: null }),
            ...this.#get().creatingTopicIds.map((creatingId) =>
              messageMapKey({ ...operationContext, topicId: creatingId }),
            ),
          ].filter((key) => key !== currentContextKey)
        : []),
    ];
    const findRunningBlockingOp = (key: string) => {
      const contextOpIds = this.#get().operationsByContext[key] || [];
      const hasQueuedMessages = (this.#get().queuedMessages[key]?.length ?? 0) > 0;
      const ownVoiceUploadIndex = optimisticUserMessageId
        ? contextOpIds.findIndex((id) => {
            const operation = this.#get().operations[id];
            return (
              operation?.type === 'uploadVoiceMessage' &&
              operation.context.messageId === optimisticUserMessageId
            );
          })
        : -1;

      return contextOpIds
        .map((id, index) => ({ index, operation: this.#get().operations[id] }))
        .find(
          ({ index, operation }) =>
            operation &&
            // Shared predicate — an op the composer already treats as finished
            // (aborting, or done with its visible output) must NOT swallow this
            // send into the tray.
            isQueueBlockingOperation(operation, { hasQueuedMessages }) &&
            // The upload transaction calls this lifecycle after its own binary is ready. It must
            // not queue behind itself (or a later voice upload); earlier voice uploads still block.
            !(
              optimisticUserMessageId &&
              operation.type === 'uploadVoiceMessage' &&
              (operation.context.messageId === optimisticUserMessageId ||
                (ownVoiceUploadIndex >= 0 && index > ownVoiceUploadIndex))
            ),
        )?.operation;
    };
    let queueTargetKey = currentContextKey;
    let runningQueueBlockingOp: ReturnType<typeof findRunningBlockingOp>;
    for (const key of queueCandidateKeys) {
      runningQueueBlockingOp = findRunningBlockingOp(key);
      if (runningQueueBlockingOp) {
        queueTargetKey = key;
        break;
      }
    }
    if (runningQueueBlockingOp) {
      // Snapshot file previews so the tray can render thumbnails AND the
      // resumed sendMessage can rebuild audioList/imageList/videoList — by the time
      // we drain, chatUploadFileList has long been cleared.
      const filesPreview: QueuedFile[] = (files ?? []).map((f) => ({
        audioMetadata: f.audioMetadata,
        id: f.id,
        mimeType: f.file?.type ?? '',
        name: f.file?.name ?? f.id,
        url: f.fileUrl || f.base64Url || f.previewUrl || '',
      }));

      this.#get().enqueueMessage(
        queueTargetKey,
        {
          id: nanoid(),
          content: message,
          editorData: editorData ?? undefined,
          files: fileIdList,
          filesPreview: filesPreview.length > 0 ? filesPreview : undefined,
          ...(forceRuntime ? { forceRuntime } : {}),
          interruptMode: 'soft',
          metadata: userMessageMetadata,
          createdAt: Date.now(),
        },
        runningQueueBlockingOp.id,
      );
      notifyMessageAccepted();
      return;
    }

    // Stop may already have moved the old operation to `cancelled`, so there is
    // no live blocker left to drain follow-ups that were queued before Stop.
    // Fold the new send into that FIFO and immediately restart the whole batch;
    // otherwise the new message jumps ahead and the older queue drains after it.
    const orphanedQueueKey = queueCandidateKeys.find((key) => {
      if ((this.#get().queuedMessages[key]?.length ?? 0) === 0) return false;
      return (this.#get().operationsByContext[key] || []).some((id) => {
        const operation = this.#get().operations[id];
        return operation?.status === 'cancelled' && operation.metadata.isAborting;
      });
    });
    if (orphanedQueueKey && !onlyAddUserMessage) {
      const filesPreview: QueuedFile[] = (files ?? []).map((file) => ({
        audioMetadata: file.audioMetadata,
        id: file.id,
        mimeType: file.file?.type ?? '',
        name: file.file?.name ?? file.id,
        url: file.fileUrl || file.base64Url || file.previewUrl || '',
      }));
      this.#get().enqueueMessage(orphanedQueueKey, {
        content: message,
        createdAt: Date.now(),
        editorData: editorData ?? undefined,
        files: fileIdList,
        filesPreview: filesPreview.length > 0 ? filesPreview : undefined,
        ...(forceRuntime ? { forceRuntime } : {}),
        id: nanoid(),
        interruptMode: 'soft',
        metadata: userMessageMetadata,
      });
      const merged = mergeQueuedMessages(this.#get().drainQueuedMessages(orphanedQueueKey));
      notifyMessageAccepted();

      setTimeout(() => {
        this.#get()
          .sendMessage({
            context: operationContext,
            editorData: merged.editorData,
            files:
              merged.filesPreview.length > 0
                ? reconstructUploadFilesFromQueue(merged.filesPreview)
                : merged.files.length > 0
                  ? (merged.files.map((id) => ({ id })) as any)
                  : undefined,
            ...(merged.forceRuntime ? { forceRuntime: merged.forceRuntime } : {}),
            message: merged.content,
            metadata: merged.metadata,
          })
          .catch((error: unknown) => {
            console.error('[sendMessage] restarting queued content after Stop failed:', error);
          });
      }, 0);

      return;
    }

    const replaceableGatewayOperationId = queueCandidateKeys
      .flatMap((key) => this.#get().operationsByContext[key] || [])
      .map((id) => this.#get().operations[id])
      .findLast(
        (operation) =>
          operation?.type === 'execServerAgentRuntime' &&
          operation.status === 'running' &&
          (operation.metadata.isAborting || operation.metadata.visibleLoadingDone),
      )?.metadata.serverOperationId;

    if (onlyAddUserMessage) {
      await this.#get().addUserMessage({
        message,
        fileList: fileIdList,
        metadata: userMessageMetadata,
      });
      notifyMessagePersisted();

      return;
    }

    // Use provided messages or query from store
    // For /newTopic from existing topic, start with empty message list (fresh topic)
    const contextKey = messageMapKey(context);
    const messages = (
      forceNewTopicFromExisting
        ? []
        : (inputMessages ??
          displayMessageSelectors.getDisplayMessagesByKey(contextKey)(this.#get()))
    ).filter((item) => !isLocalOnlyMessage(item));
    // Historical callback/tool sibling forks are rendered with the recovered
    // taskCallback card as supplemental history. It is not the active
    // conversational tail: using it here lets findLastMessageId descend into
    // the callback's inactive assistant branch, so the next user message is
    // persisted there and disappears from the main flow after reconciliation.
    const lastMessage =
      messages.findLast((message) => message.role !== 'taskCallback') ?? messages.at(-1);

    useUserMemoryStore.getState().setActiveMemoryContext({
      agent: getAgentMeta(agentId),
      topic: getCurrentChatTopic(),
      latestUserMessage: lastMessage?.content,
      sendingMessage: message,
    });

    // Use provided parentId or calculate from messages
    let parentId: string | undefined = forceNewTopicFromExisting ? undefined : inputParentId;
    if (!parentId && lastMessage) {
      parentId = displayMessageSelectors.findLastMessageId(lastMessage.id)(this.#get());
    }

    // Mint the ids this turn will live under, up front. These are the FINAL
    // ids: the server honours them verbatim (`newUserMessage.id` /
    // `newAssistantMessage.id`), so the optimistic rows never have to be
    // re-keyed when the response lands. That is what keeps the conversation's
    // identity — and therefore the mounted message list — stable across the
    // whole send.
    const tempId = optimisticUserMessageId ?? generateEntityId('messages');
    const tempAssistantId = generateEntityId('messages');
    const { operationId, abortController } = this.#get().startOperation({
      type: 'sendMessage',
      context: { ...operationContext, messageId: tempId },
      label: 'Send Message',
      metadata: {
        // Mark this as thread operation if threadId exists
        inThread: !!operationContext.threadId,
      },
    });
    // Voice recording starts before a first-send topic exists, so its upload
    // transaction and local row initially live in the legacy `_new` bucket.
    // Adopt the client-minted topic context before looking up that row; otherwise
    // the formal send would create a duplicate in the minted bucket.
    this.#get().moveVoiceMessages(context, operationContext);

    const cleanupTempMessages = (options?: { preserveOptimisticUser?: boolean }) => {
      const ids = options?.preserveOptimisticUser ? [tempAssistantId] : [tempId, tempAssistantId];
      this.#get().internal_dispatchMessage({ ids, type: 'deleteMessages' }, { operationId });
    };
    const restoreUnacceptedVoiceMessageContext = () => {
      if (!optimisticUserMessageId || hasNotifiedMessageAccepted) return;

      // The minted topic is rolled back on a pre-accept failure. Return the
      // retry-owned upload operation and playable local row to the visible
      // `_new` conversation instead of leaving them under a deleted topic id.
      this.#get().moveVoiceMessages(operationContext, context);
    };
    if (signal) {
      const cancelFromCaller = () => {
        const operation = this.#get().operations[operationId];
        if (hasNotifiedMessageAccepted || operation?.status !== 'running') return;

        this.#get().cancelOperation(operationId, 'Caller cancelled before message acceptance');
      };

      if (signal.aborted) {
        cancelFromCaller();
      } else {
        signal.addEventListener('abort', cancelFromCaller, { once: true });
        detachCallerAbort = () => signal.removeEventListener('abort', cancelFromCaller);
      }
    }
    throwIfSendAborted(signal);

    // Shared run lifecycle for the post-persist topic-title hook. Built once here
    // so all three runtime branches fire the SAME `afterUserMessagePersisted`
    // — gateway/hetero previously had no LLM title before the unified lifecycle.
    // `parentMessage*` are unused by this hook.
    const sendRunScope: RunScope =
      operationContext.scope === 'sub_agent' ? 'sub_agent' : 'top_level';
    const sendRunLifecycle = buildRunLifecycle(this.#get, {
      context: operationContext,
      parentMessageId: parentId ?? tempId,
      parentMessageType: 'user',
      runId: operationId,
      runScope: sendRunScope,
      runtimeType,
    });

    // Construct local media preview for server-mode temporary messages (S3 URL takes priority).
    // Use the captured `files` param (not the global file store) so the optimistic preview
    // also works on the queue-drain path, where chatUploadFileList has already been cleared.
    const filesForPreview = files ?? [];
    const tempImages: ChatImageItem[] = filesForPreview
      .filter((f) => f.file?.type?.startsWith('image'))
      .map((f) => ({
        id: f.id,
        url: f.fileUrl || f.base64Url || f.previewUrl || '',
        alt: f.file?.name || f.id,
      }));
    const tempVideos: ChatVideoItem[] = filesForPreview
      .filter((f) => f.file?.type?.startsWith('video'))
      .map((f) => ({
        id: f.id,
        url: f.fileUrl || f.base64Url || f.previewUrl || '',
        alt: f.file?.name || f.id,
      }));
    const tempAudios: ChatAudioItem[] = filesForPreview
      .filter((f) => f.audioMetadata || f.file?.type?.startsWith('audio'))
      .map((f) => ({
        ...f.audioMetadata,
        id: f.id,
        url: f.fileUrl || f.base64Url || f.previewUrl || '',
        alt: f.file?.name || f.id,
      }));

    const optimisticUserMessage = {
      content: message,
      editorData: editorData ?? undefined,
      // if message has attached with files, then add files to message and the agent
      files: fileIdList,
      role: 'user' as const,
      agentId: operationContext.agentId,
      // if there is topicId, then add topicId to message
      topicId: operationContext.topicId ?? undefined,
      threadId: operationContext.threadId ?? undefined,
      audioList: tempAudios.length > 0 ? tempAudios : undefined,
      imageList: tempImages.length > 0 ? tempImages : undefined,
      videoList: tempVideos.length > 0 ? tempVideos : undefined,
      // Pass metadata for immediate display
      metadata: userMessageMetadata,
    };
    const operationMessageKey = messageMapKey(
      this.#get().internal_getConversationContext({ operationId }),
    );
    const existingOptimisticUserMessage = this.#get().dbMessagesMap[operationMessageKey]?.find(
      (item) => item.id === tempId && item.role === 'user',
    );

    // A voice message can render a local-only row before its binary upload finishes. Adopt that
    // row in place so the formal send lifecycle keeps its stable position and never duplicates it.
    if (existingOptimisticUserMessage) {
      this.#get().internal_dispatchMessage(
        {
          id: tempId,
          type: 'updateMessage',
          value: {
            ...optimisticUserMessage,
            groupId: operationContext.groupId,
            metadata: {
              ...existingOptimisticUserMessage.metadata,
              ...userMessageMetadata,
              scope: existingOptimisticUserMessage.metadata?.scope,
            },
          },
        },
        { operationId },
      );
    } else {
      // use optimistic update to avoid the slow waiting (now with operationId for correct context)
      this.#get().optimisticCreateTmpMessage(optimisticUserMessage, {
        operationId,
        tempMessageId: tempId,
      });
    }
    this.#get().optimisticCreateTmpMessage(
      {
        content: LOADING_FLAT,
        role: 'assistant',
        agentId,
        // if there is topicId, then add topicId to message
        topicId: operationContext.topicId ?? undefined,
        threadId: operationContext.threadId ?? undefined,
        // Pass isSupervisor metadata for group orchestration (consistent with server)
        metadata: operationContext.isSupervisor
          ? { isSupervisor: true, orchestrationRole: 'supervisor' as const }
          : undefined,
      },
      { operationId, tempMessageId: tempAssistantId },
    );

    // Associate temp messages with operation
    this.#get().associateMessageWithOperation(tempId, operationId);
    this.#get().associateMessageWithOperation(tempAssistantId, operationId);

    // Group main topic lists are keyed by `group_${groupId}`. Keeping the
    // supervisor agent id here would write "group first message" placeholders
    // into `group_agent_${groupId}_${agentId}`, invisible to the group sidebar.
    const topicListAgentId =
      operationContext.groupId && operationContext.scope === 'group'
        ? undefined
        : operationContext.agentId;
    const optimisticTopicScope = {
      agentId: topicListAgentId,
      groupId: operationContext.groupId ?? undefined,
    };
    // A topic created by this send pins the model it was started with, same as
    // the manual createTopic/saveToTopic and Gateway (AiAgentService) paths. The
    // snapshot goes to the top-level `topics.model`/`provider` columns (config
    // source of truth) — generation and ChatInput display resolve from it
    // (topicSelectors.getTopicModelById).
    const newTopicModelSnapshot = willCreateNewTopic
      ? snapshotAgentModel(operationContext.agentId)
      : undefined;

    // Adopt the minted topic id NOW, synchronously with the optimistic message
    // dispatch above: insert the sidebar row and point `activeTopicId` at it in
    // the same React commit that shows the optimistic pair. The conversation's
    // contextKey is therefore final from its very first painted frame — nothing
    // remounts when the server later confirms the topic, which is the flicker
    // this whole flow used to have. Everything after this point (cwd
    // resolution, the runtime branches) awaits, so it must come before them.
    if (mintedTopicId) {
      this.#get().internal_dispatchTopic(
        {
          ...optimisticTopicScope,
          optimistic: true,
          type: 'addTopic',
          value: {
            id: mintedTopicId,
            ...newTopicModelSnapshot,
            ...(operationContext.groupId ? {} : { sessionId: operationContext.agentId }),
            title: newTopicTitle,
          },
        },
        'sendMessage/optimisticCreateTopic',
      );
      getFileStoreState().moveChatContextSelections(
        messageMapKey({ ...operationContext, topicId: null }),
        currentContextKey,
      );
      await this.#get().switchTopic(mintedTopicId, { skipRefreshMessage: true });
    }

    // The topic list store is paginated — a deep-linked older topic can be the
    // ACTIVE topic yet miss `getTopicById`. For hetero runs that miss used to
    // silently resolve the agent/device default cwd instead of the topic's
    // bound workingDirectory and drop `--resume` (fresh CLI session, context
    // lost, no error) — fall back to the server row. A topic this send is
    // about to create has no server row, so the lookup is skipped entirely.
    const existingTopic = await resolveExistingTopicForRun({
      fetchTopicDetail: async (id) => {
        const scope = getCacheScope();
        const observedAt = nextProjectionObservedAt();
        const topic = await topicService.getTopicDetail(id);
        if (topic) {
          getProjectionStoreState().commitChatTopicRecords(scope, [topic], {
            observedAt,
            source: 'network',
          });
        } else {
          getProjectionStoreState().deleteChatTopicProjections(scope, [id], observedAt);
        }
        const projectionScope = getProjectionStoreState().scopes[scope];
        const record = projectionScope?.records.topic[id];
        if (record && !activeProjectionRecord(record)) return null;
        const canonical = projectionScope
          ? selectChatTopicListItem(projectionScope, id)
          : undefined;
        return canonical
          ? ({
              ...canonical,
              createdAt: toTopicTimestamp(canonical.createdAt, topic?.createdAt ?? 0),
              historySummary: canonical.historySummary ?? undefined,
              metadata: canonical.metadata ?? undefined,
              sessionId: canonical.sessionId ?? undefined,
              updatedAt: toTopicTimestamp(canonical.updatedAt, topic?.updatedAt ?? 0),
            } satisfies ChatTopic)
          : topic;
      },
      isHetero: !!heterogeneousProvider,
      storeTopic:
        operationContext.topicId && !willCreateNewTopic
          ? getChatTopicById(operationContext.topicId)
          : undefined,
      topicId: willCreateNewTopic ? undefined : operationContext.topicId,
    });
    const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
    // Resolve the cwd for every hetero-provider run that lands on a MACHINE
    // (in-process `hetero` runtime, or a gateway dispatch whose effective
    // target routes to a device) — the server can only honour a cwd the client
    // resolved (per-user legacy slot included) if it rides along as the new
    // topic's initial metadata. Sandbox/none targets must NOT resolve one: the
    // desktop/home fallback is a local machine path that doesn't exist in an
    // ephemeral cloud sandbox and would pollute the topic's metadata.
    const heteroEffectiveTarget = heterogeneousProvider
      ? resolveExecutionTarget(agencyConfig, {
          clientExecutionAvailable: isDesktop,
          isHetero: true,
          workspaceScoped,
        })
      : undefined;
    const resolvesHeteroCwd =
      !!heterogeneousProvider &&
      (heteroEffectiveTarget === 'local' ||
        heteroEffectiveTarget === 'device' ||
        heteroEffectiveTarget === 'auto');
    // Same precedence as `getAgentWorkingDirectoryById`, but over the MERGED
    // config — the selector reads the raw shared row internally, which could
    // fall back to a cwd registered for another member's device. Desktop/home
    // is the only neutral last resort.
    const heteroCwdContext =
      resolvesHeteroCwd && isDesktop ? globalAgentContextManager.getContext() : undefined;
    const heteroCwdParams = resolvesHeteroCwd
      ? {
          agencyConfig,
          currentDeviceId,
          fallback: heteroCwdContext?.desktopPath ?? heteroCwdContext?.homePath,
          legacyAgentWorkingDirectory: agentState.localAgentWorkingDirectoryMap[agentId],
          workspaceScoped,
        }
      : undefined;
    const agentWorkingDirectory = heteroCwdParams
      ? resolveAgentWorkingDirectory(heteroCwdParams)
      : undefined;
    const agentWorkingDirectoryConfig = heteroCwdParams
      ? resolveAgentWorkingDirectoryConfig(heteroCwdParams)
      : undefined;
    // Heterogeneous CLI agents (Claude Code, Codex, …) store sessions per-cwd
    // (`~/.claude/projects/<encoded-cwd>/`). Anchor their session cwd to the
    // SOURCE repo, NOT the selected worktree, so switching worktree keeps cwd +
    // sessionId consistent and never drops the conversation context. The active
    // worktree lives only in `workingDirectoryConfig.git.activeWorktree` as a
    // record. The per-cwd session store is a LOCAL CLI trait — remote platform
    // agents (openclaw / hermes) run through the gateway with no such
    // constraint, so they (like non-hetero runtimes) keep the effective
    // (worktree) path.
    const isLocalCliHetero =
      !!heterogeneousProvider && !isRemoteHeterogeneousType(heterogeneousProvider.type);
    const resolveWorkingDirPath = isLocalCliHetero
      ? getWorkingDirSourcePath
      : getWorkingDirEffectivePath;
    const workingDirectory =
      resolveWorkingDirPath(existingTopic?.metadata?.workingDirectoryConfig) ??
      existingTopic?.metadata?.workingDirectory ??
      agentWorkingDirectory;
    const workingDirectoryConfig =
      existingTopic?.metadata?.workingDirectoryConfig ??
      (existingTopic?.metadata?.workingDirectory
        ? { path: existingTopic.metadata.workingDirectory }
        : agentWorkingDirectoryConfig);
    const pendingTopicRepos =
      runtimeType === 'gateway' && willCreateNewTopic && operationContext.agentId
        ? getPendingTopicRepos(operationContext.agentId)
        : [];
    // Example: a pending repo topic without this metadata renders under "No
    // directory" until the server row lands.
    const optimisticTopicMetadata: ChatTopicMetadata | undefined =
      pendingTopicRepos.length > 0
        ? {
            repos: pendingTopicRepos,
            workingDirectory: pendingTopicRepos[0],
            workingDirectoryConfig: { path: pendingTopicRepos[0], repoType: 'github' },
          }
        : workingDirectory
          ? {
              workingDirectory,
              ...(workingDirectoryConfig ? { workingDirectoryConfig } : {}),
            }
          : undefined;

    // The sidebar row was already inserted (title + model) before the awaits
    // above; the cwd/repos metadata only resolves here, so patch it on now.
    // `optimisticTopic` keeps carrying the full snapshot for the resolve /
    // rollback helpers below.
    const optimisticTopic: OptimisticTopicPlaceholder | undefined = mintedTopicId
      ? {
          id: mintedTopicId,
          ...(optimisticTopicMetadata ? { metadata: optimisticTopicMetadata } : {}),
          ...newTopicModelSnapshot,
          title: newTopicTitle,
        }
      : undefined;
    let optimisticTopicActive = false;

    const addResolvedTopicPlaceholder = (
      topicId: string,
      title: string,
      action: string,
      extra?: {
        metadata?: ChatTopicMetadata;
        model?: string;
        /**
         * True only for the client-only placeholder inserted before the server
         * has created the topic. The topic slice keeps those ids so a refetch
         * landing mid-send re-prepends the row instead of wiping it.
         */
        optimistic?: boolean;
        provider?: string;
      },
    ) => {
      this.#get().internal_dispatchTopic(
        {
          ...optimisticTopicScope,
          ...(extra?.optimistic ? { optimistic: true } : {}),
          type: 'addTopic',
          value: {
            id: topicId,
            ...(extra?.metadata ? { metadata: extra.metadata } : {}),
            ...(extra?.model ? { model: extra.model, provider: extra.provider } : {}),
            ...(operationContext.groupId ? {} : { sessionId: operationContext.agentId }),
            title,
          },
        },
        action,
      );
    };

    const resolveOptimisticTopic = (topicId: string, title = optimisticTopic?.title) => {
      if (!optimisticTopic || !optimisticTopicActive) {
        addResolvedTopicPlaceholder(
          topicId,
          title || t('defaultTitle', { ns: 'topic' }),
          'sendMessage/reconcileOptimisticTopic/add',
          {
            metadata: optimisticTopic?.metadata,
            model: optimisticTopic?.model,
            provider: optimisticTopic?.provider,
          },
        );
        return;
      }

      this.#get().internal_replaceTopicId({
        ...optimisticTopicScope,
        nextId: topicId,
        previousId: optimisticTopic.id,
        value: {
          ...(optimisticTopic.metadata ? { metadata: optimisticTopic.metadata } : {}),
          ...(optimisticTopic.model
            ? { model: optimisticTopic.model, provider: optimisticTopic.provider }
            : {}),
          ...(operationContext.groupId ? {} : { sessionId: operationContext.agentId }),
          title: title || t('defaultTitle', { ns: 'topic' }),
        },
      });
      optimisticTopicActive = false;
    };

    const rollbackOptimisticTopic = (action: string) => {
      if (!optimisticTopic || !optimisticTopicActive) return;

      getFileStoreState().moveChatContextSelections(
        currentContextKey,
        messageMapKey({ ...operationContext, topicId: null }),
      );
      if (this.#get().activeTopicId === optimisticTopic.id) {
        void this.#get().switchTopic(null, { skipRefreshMessage: true });
      }
      this.#get().internal_dispatchTopic(
        { ...optimisticTopicScope, type: 'deleteTopic', id: optimisticTopic.id },
        action,
      );
      optimisticTopicActive = false;
    };

    if (optimisticTopic) {
      // The row itself (title + model, marked `optimistic`) was inserted before
      // the awaits above so it shares the first paint with the optimistic
      // messages. The cwd/repos metadata only resolved after those awaits —
      // patch it on now instead of re-adding the row (an addTopic here would
      // unshift a duplicate).
      if (optimisticTopic.metadata) {
        this.#get().internal_dispatchTopic(
          {
            ...optimisticTopicScope,
            id: optimisticTopic.id,
            type: 'updateTopic',
            value: { metadata: optimisticTopic.metadata },
          },
          'sendMessage/optimisticTopicMetadata',
        );
      }
      optimisticTopicActive = true;
    }

    // Store editor state in operation metadata for cancel restoration
    const jsonState = preserveComposer
      ? undefined
      : (inputEditorData ?? targetInputEditor?.getJSONState());
    this.#get().updateOperationMetadata(operationId, {
      inputEditorTempState: jsonState,
      inputSendErrorMsg: undefined,
    });

    // ── External agent mode: delegate to heterogeneous agent CLI (desktop only) ──
    // Per-agent heterogeneousProvider config takes priority over the global gateway mode.
    if (runtimeType === 'hetero' && heterogeneousProvider) {
      // Resolve cwd up-front so the new topic is bound to a project at
      // creation time. Otherwise the row stays NULL until the post-execution
      // metadata write — which never lands on cancel/error and meanwhile
      // makes By-Project grouping miss the topic and `--resume` unsafe.
      //
      // Priority: topic-level cwd (once a topic is bound to a project) wins
      // over the agent-level default. Without this, a topic pinned to dir A
      // would silently execute under the agent's current default dir B and
      // lose resume.
      // Persist messages to DB first (same as client mode)
      let heteroData: SendMessageServerResponse | undefined;
      try {
        throwIfSendAborted(signal);
        heteroData = await aiChatService.sendMessageInServer(
          {
            agentId: operationContext.agentId,
            groupId: operationContext.groupId ?? undefined,
            // External CLIs own model selection and may reroute independently
            // from the agent's requested model. Persist only the runtime
            // provider up front; the adapter backfills the actual model later
            // if the CLI reports it.
            newAssistantMessage: {
              agentId: directMentionRoute ? agentId : undefined,
              id: tempAssistantId,
              provider: heterogeneousProvider.type,
            },
            newTopic: willCreateNewTopic
              ? {
                  // Same id the optimistic sidebar row already uses.
                  id: optimisticTopic?.id,
                  metadata: workingDirectory
                    ? {
                        workingDirectory,
                        ...(workingDirectoryConfig ? { workingDirectoryConfig } : {}),
                      }
                    : undefined,
                  ...newTopicModelSnapshot,
                  title: newTopicTitle,
                  topicMessageIds: messages.map((m) => m.id),
                }
              : undefined,
            newUserMessage: {
              content: message,
              editorData,
              files: fileIdList,
              id: tempId,
              metadata: userMessageMetadata,
              contextSelections,
              pageSelections,
              parentId,
            },
            threadId: operationContext.threadId ?? undefined,
            topicFilter: this.#getTopicFilter(
              topicListAgentId,
              operationContext.groupId ?? undefined,
            ),
            topicPageSize: systemStatusSelectors.topicPageSize(useGlobalStore.getState()),
            // While creating, the topic exists only client-side — the server
            // sees `newTopic` (with the minted id) and no topicId, exactly the
            // shape an older client sends.
            topicId: willCreateNewTopic ? undefined : (operationContext.topicId ?? undefined),
          },
          abortController,
        );
      } catch (e) {
        console.error('[HeterogeneousAgent] Failed to persist messages:', e);
        if (this.#get().operations[operationId]?.status !== 'cancelled') {
          this.#get().failOperation(operationId, {
            message: e instanceof Error ? e.message : 'Unknown error',
            type: 'HeterogeneousAgentError',
          });
        }
        cleanupTempMessages({ preserveOptimisticUser: Boolean(optimisticUserMessageId) });
        detachUnacceptedCallerAbort();
        rollbackOptimisticTopic('sendMessage/rollbackOptimisticTopic');
        restoreUnacceptedVoiceMessageContext();
        return;
      }

      if (!heteroData) {
        cleanupTempMessages({ preserveOptimisticUser: Boolean(optimisticUserMessageId) });
        detachUnacceptedCallerAbort();
        rollbackOptimisticTopic('sendMessage/rollbackOptimisticTopic');
        restoreUnacceptedVoiceMessageContext();
        return;
      }
      notifyMessageAccepted();

      // Update context with server-created topicId. Once the server has returned a
      // persisted topic, the hetero stream must target the real topic bucket; keeping
      // `isNew` would route chunks to `main_<agent>_<topic>_new`.
      const heteroTopicId = heteroData.topicId ?? operationContext.topicId;
      const shouldResolveNewTopicKey = !!heteroTopicId && operationContext.scope !== 'thread';
      const heteroContext = {
        ...operationContext,
        // startOperation inherits from the parent op before merging this context.
        // Use an explicit false so the child exec op does not inherit `isNew: true`.
        ...(shouldResolveNewTopicKey ? { isNew: false } : {}),
        topicId: heteroTopicId,
      };
      const heteroResponseMeta = heteroData as SendMessageServerResponseMeta;
      const heteroMessageKey = messageMapKey(heteroContext);
      this.#get().moveQueuedMessages(currentContextKey, heteroMessageKey);
      getFileStoreState().moveChatContextSelections(currentContextKey, heteroMessageKey);
      // Legacy queue location: follow-ups enqueued behind an op still
      // registered under the pre-mint `_new` key.
      if (willCreateNewTopic)
        this.#get().moveQueuedMessages(
          messageMapKey({ ...operationContext, topicId: null }),
          heteroMessageKey,
        );
      this.#get().moveVoiceMessages(operationContext, heteroContext);
      const heteroMessages = heteroResponseMeta.__isPartialMessages
        ? mergePartialPersistedMessages(
            this.#get().messagesMap[heteroMessageKey] || [],
            heteroData.messages,
            [tempId, tempAssistantId],
          )
        : heteroData.messages;

      // Replace optimistic messages with persisted ones
      this.#get().replaceMessages(heteroMessages, {
        action: 'sendMessage/serverResponse',
        context: heteroContext,
      });

      // Handle new topic creation
      if (heteroData.isCreateNewTopic && heteroData.topicId) {
        if (heteroData.topics) {
          if (optimisticTopic && optimisticTopicActive) {
            resolveOptimisticTopic(heteroData.topicId, newTopicTitle);
          }
          const pageSize = systemStatusSelectors.topicPageSize(useGlobalStore.getState());
          this.#get().internal_updateTopics(topicListAgentId, {
            groupId: operationContext.groupId,
            items: heteroData.topics.items,
            pageSize,
            total: heteroData.topics.total,
          });
        } else if (!context.isolatedTopic) {
          resolveOptimisticTopic(heteroData.topicId, newTopicTitle);
          void Promise.resolve(this.#get().refreshTopic()).catch(console.error);
        }
        await this.#get().switchTopic(heteroData.topicId, {
          clearNewKey: true,
          skipRefreshMessage: true,
        });
      }

      let directMentionThreadId: string | undefined;
      let heteroExecutionAssistantId = heteroData.assistantMessageId;
      let heteroExecutionContext = heteroContext;

      if (directMentionRoute) {
        if (!heteroTopicId) throw new Error('Direct mention requires a persisted topic');

        const task = await aiAgentService.createClientTaskThread({
          agentId,
          assistantMessage: { provider: heterogeneousProvider.type },
          instruction: message,
          parentMessageId: heteroData.assistantMessageId,
          title: message.slice(0, 50),
          topicId: heteroTopicId,
        });
        if (!task.assistantMessageId) {
          throw new Error('Direct mention thread is missing an assistant placeholder');
        }

        directMentionThreadId = task.threadId;
        heteroExecutionAssistantId = task.assistantMessageId;
        heteroExecutionContext = {
          ...heteroContext,
          agentId,
          scope: 'sub_agent',
          subAgentId: agentId,
          threadId: task.threadId,
        };
        this.#get().replaceMessages(task.threadMessages, { context: heteroExecutionContext });
        void this.#get().refreshThreads();
      }

      // No temp-message cleanup: the optimistic rows were created under the very
      // ids the server just persisted, so `replaceMessages` above already
      // reconciled them in place. Deleting them here would delete the real ones.

      // Complete sendMessage operation, start ACP execution as child operation
      this.#get().completeOperation(operationId);
      notifyMessagePersisted();

      // Clear editor temp state — the user's message is already persisted, so
      // a later Stop click must NOT restore it into the input (would feel like
      // the app re-sent the message). Client/Gateway paths clear this at
      // line 684-686 after `sendMessageInServer` resolves, but the hetero
      // branch returns early (line 498) and never reaches that clear.
      this.#get().updateOperationMetadata(operationId, { inputEditorTempState: null });

      if (abortController.signal.aborted) {
        return {
          assistantMessageId: heteroData.assistantMessageId,
          userMessageId: heteroData.userMessageId,
        };
      }

      // Topic title: hetero used to set only a sliced placeholder
      // title on new topics — upgrade it to the LLM summary via the shared hook
      // (reads the just-persisted conversation from the store). Fire-and-forget.
      void sendRunLifecycle
        .afterUserMessagePersisted({
          assistantMessageId: heteroData.assistantMessageId,
          context: heteroContext,
          isCreateNewTopic: heteroData.isCreateNewTopic,
          operationId,
          runId: operationId,
          runScope: sendRunScope,
          runtimeType,
          topicId: heteroData.topicId,
        })
        .catch(console.error);

      // Sidebar "running" spinner for hetero runs is driven off the persisted
      // `topic.status === 'running'` (written by the executor's writeTopicStatus,
      // and bucketed by resolveStatusBucket) plus the running
      // execHeterogeneousAgent operation below (operations-driven overlay).

      // Start heterogeneous agent execution
      const { operationId: heteroOpId } = this.#get().startOperation({
        context: heteroExecutionContext,
        label: 'Heterogeneous Agent Execution',
        metadata: { heterogeneousType: heterogeneousProvider.type },
        parentOperationId: operationId,
        type: 'execHeterogeneousAgent',
      });

      this.#get().associateMessageWithOperation(heteroData.assistantMessageId, heteroOpId);
      this.#get().associateMessageWithOperation(heteroExecutionAssistantId, heteroOpId);

      try {
        const { executeHeterogeneousAgent } =
          await import('../transports/hetero/heterogeneousAgentExecutor');
        // Extract imageList from the persisted user message (chatUploadFileList
        // may already be cleared by this point, so we read from DB instead)
        const userMsg = heteroData.messages.find((m: any) => m.id === heteroData.userMessageId);
        const persistedImageList = userMsg?.imageList;
        const persistedMetadata = userMsg?.metadata as MessageMetadata | undefined;
        const effectiveContextSelections = contextSelections?.length
          ? contextSelections
          : persistedMetadata?.contextSelections;
        const effectivePageSelections = pageSelections?.length
          ? pageSelections
          : persistedMetadata?.pageSelections;

        // Read heterogeneous-agent session id from topic metadata for multi-turn
        // resume. `resolveHeteroResume` drops the sessionId when the saved cwd
        // doesn't match the current one, so CC doesn't emit
        // "No conversation found with session ID".
        // Store lookup first (freshest optimistic edits), but fall back to the
        // server row resolved above — the paginated store misses deep-linked
        // older topics, and a miss here silently dropped `--resume` even when
        // the cwd resolution already used the topic's bound workingDirectory.
        const topic =
          (heteroContext.topicId ? getChatTopicById(heteroContext.topicId) : undefined) ??
          existingTopic;
        const { cwdChanged, resumeSessionId } = resolveHeteroResume(
          topic?.metadata,
          workingDirectory,
        );
        if (cwdChanged) {
          toast.info(t('heteroAgent.resumeReset.cwdChanged', { ns: 'chat' }));
        }

        await executeHeterogeneousAgent(() => this.#get(), {
          assistantMessageId: heteroExecutionAssistantId,
          context: heteroExecutionContext,
          contextSelections: effectiveContextSelections,
          heterogeneousProvider,
          imageList: persistedImageList?.length ? persistedImageList : undefined,
          message,
          operationId: heteroOpId,
          pageSelections: effectivePageSelections,
          resumeSessionId,
          workingDirectory,
          workingDirectoryConfig,
        });

        if (directMentionThreadId) {
          const threadMessages =
            this.#get().dbMessagesMap[messageMapKey(heteroExecutionContext)] || [];
          const metrics = aggregateSubagentMetrics(threadMessages);
          const resultContent =
            threadMessages.findLast((item) => item.role === 'assistant')?.content || '';
          await aiAgentService.updateClientTaskThreadStatus({
            completionReason: 'done',
            metadata: {
              totalMessages: threadMessages.length,
              totalTokens: metrics.totalTokens,
              totalToolCalls: metrics.toolCalls,
            },
            resultContent,
            threadId: directMentionThreadId,
          });
          // updateClientTaskThreadStatus owns the durable source-message
          // projection. Mirror that result into the persisted Topic bucket
          // without issuing a second write whose returned message list can race
          // and restore the original loading placeholder.
          this.#get().internal_dispatchMessage(
            {
              id: heteroData.assistantMessageId,
              type: 'updateMessage',
              value: { content: resultContent },
            },
            { context: heteroContext },
          );
          void this.#get().refreshThreads();
        }
      } catch (e) {
        console.error('[HeterogeneousAgent] Execution failed:', e);
        this.#get().failOperation(heteroOpId, {
          message: e instanceof Error ? e.message : 'Unknown error',
          type: 'HeterogeneousAgentError',
        });
      }

      return {
        assistantMessageId: heteroData.assistantMessageId,
        userMessageId: heteroData.userMessageId,
      };
    }

    // ── Gateway mode: skip sendMessageInServer, let execAgentTask handle everything ──
    if (runtimeType === 'gateway' && !directMentionRoute) {
      try {
        // Pass `sendMessage` as `parentOperationId` so executeGatewayAgent
        // completes it the instant phase-1 init finishes (after the child
        // `execServerAgentRuntime` op starts). Without this hand-off the
        // input loading state would drop during the execAgentTask round-trip
        // and the send button would flicker back to "send".
        const result = await this.#get().executeGatewayAgent({
          // The ids this send's optimistic rows already render under. The
          // server honours them, so the gateway path converges on the same ids
          // instead of minting its own — same contract as sendMessageInServer.
          clientIds: {
            assistantMessageId: tempAssistantId,
            topicId: optimisticTopic?.id,
            userMessageId: tempId,
          },
          // Execution context: what the SERVER should act on. While creating,
          // the topic exists only client-side, so the server must see no
          // topicId (that is what makes execAgent create it — under
          // `clientIds.topicId`). The message context below keeps the minted id
          // so streamed messages land in the bucket already on screen.
          context: willCreateNewTopic
            ? { ...operationContext, topicId: undefined }
            : operationContext,
          messageContext: operationContext,
          fileIds: fileIdList,
          message,
          metadata: requestMetadata,
          onMessageAccepted: notifyMessageAccepted,
          parentOperationId: operationId,
          replacesOperationId: replaceableGatewayOperationId,
          optimisticTopic,
          // Forward @-mentioned tool ids so the server runtime enables them for
          // this run — the gateway/server path otherwise never sees the mention
          // selection (only the client runtime did). Omit when empty.
          selectedToolIds:
            selectedTools.length > 0 ? selectedTools.map((tool) => tool.identifier) : undefined,
          // Forward @-mentioned agents so the server supervisor can delegate to
          // them (multi-mention). Mirrors the client runtime's `initialContext`
          // injection: the server enables the callAgent tool and injects the
          // mentioned-agents delegation context so the supervisor calls them.
          // Omit when empty (single-mention executes the target directly and does
          // not need supervisor delegation context). Non-group only — group @member mentions are handled by
          // the group orchestration path, not agent-management delegation.
          mentionedAgents: hasMentionedAgents ? mentionedAgents : undefined,
          // Pass temp message IDs so the UI doesn't show a blank loading
          // state while waiting for the first step_start event to replace
          // messages with the server's real IDs.
          tempMessageIds: [tempAssistantId],
        });
        const cancelledAfterPersistence = abortController.signal.aborted;

        // Topic title: gateway-created topics had no LLM-summarized
        // title. executeGatewayAgent has already replaced messages + switched to
        // the new topic, so the shared hook reads the persisted conversation from
        // the store and titles it. Fire-and-forget.
        if (result.topicId) {
          // executeGatewayAgent resolved the optimistic topic row via
          // internal_replaceTopicId; nothing to release here — the sidebar
          // spinner is operations-driven plus the persisted
          // `status === 'running'`.
          if (optimisticTopic && optimisticTopicActive) {
            optimisticTopicActive = false;
          }
          if (!cancelledAfterPersistence) {
            void sendRunLifecycle
              .afterUserMessagePersisted({
                assistantMessageId: result.assistantMessageId,
                context: { ...operationContext, topicId: result.topicId },
                isCreateNewTopic: willCreateNewTopic,
                operationId,
                runId: operationId,
                runScope: sendRunScope,
                runtimeType,
                topicId: result.topicId,
              })
              .catch(console.error);
          }
        } else {
          rollbackOptimisticTopic('sendMessage/rollbackOptimisticTopic');
        }

        notifyMessagePersisted();

        return {
          assistantMessageId: result.assistantMessageId,
          userMessageId: result.userMessageId,
        };
      } catch (e) {
        // User cancelled during phase-1 init — `cancelOperation` already set
        // the op to 'cancelled' and `executeGatewayAgent` cleaned up the
        // server task. Don't clobber that with 'failed'.
        const op = this.#get().operations[operationId];
        if (op?.status === 'cancelled') {
          cleanupTempMessages({
            preserveOptimisticUser: Boolean(optimisticUserMessageId && !hasNotifiedMessageAccepted),
          });
          detachUnacceptedCallerAbort();
          rollbackOptimisticTopic('sendMessage/rollbackOptimisticTopic');
          restoreUnacceptedVoiceMessageContext();
          return;
        }

        console.error('[Gateway] Failed to start server-side agent:', e);
        this.#get().failOperation(operationId, {
          message: e instanceof Error ? e.message : 'Unknown error',
          type: 'GatewayError',
        });
        cleanupTempMessages({
          preserveOptimisticUser: Boolean(optimisticUserMessageId && !hasNotifiedMessageAccepted),
        });
        detachUnacceptedCallerAbort();
        rollbackOptimisticTopic('sendMessage/rollbackOptimisticTopic');
        restoreUnacceptedVoiceMessageContext();
        return;
      }
    }

    // ── Client mode: send via server API then run agent locally ──
    let data: SendMessageServerResponse | undefined;
    const isCreatedTopicResponse = (response?: SendMessageServerResponse) =>
      Boolean(
        response && (response.isCreateNewTopic || (willCreateNewTopic && !!response.topicId)),
      );

    try {
      throwIfSendAborted(signal);
      const { model = DEFAULT_MODEL, provider = DEFAULT_PROVIDER } =
        getAgentProjectionById(agentId) ?? {};

      const topicId = operationContext.topicId;

      // Persist selected skill/tool context into user message content so it survives across turns.
      // Deduplicate: skip skills/tools already @mentioned in earlier messages (via editorData).
      const previouslyMentionedSkills = new Set<string>();
      const previouslyMentionedTools = new Set<string>();

      for (const m of messages) {
        if (m.role !== 'user') continue;
        for (const s of parseSelectedSkillsFromEditorData(m.editorData ?? undefined)) {
          previouslyMentionedSkills.add(s.identifier);
        }
        for (const t of parseSelectedToolsFromEditorData(m.editorData ?? undefined)) {
          previouslyMentionedTools.add(t.identifier);
        }
      }
      const dedupedSkills = enrichedSelectedSkills.filter(
        (s) => !previouslyMentionedSkills.has(s.identifier),
      );
      const dedupedTools = enrichedSelectedTools.filter(
        (t) => !previouslyMentionedTools.has(t.identifier),
      );

      const skillContext = formatSelectedSkillsContext(dedupedSkills);
      const toolContext = formatSelectedToolsContext(dedupedTools);
      const contextSuffix = [skillContext, toolContext].filter(Boolean).join('\n');
      const persistedContent = contextSuffix ? `${message}\n\n${contextSuffix}` : message;
      data = await aiChatService.sendMessageInServer(
        {
          newUserMessage: {
            content: persistedContent,
            editorData,
            files: fileIdList,
            id: tempId,
            metadata: userMessageMetadata,
            contextSelections,
            pageSelections,
            parentId,
          },
          preloadMessages: undefined,
          // While creating, the topic exists only client-side — the server
          // sees `newTopic` (with the minted id) and no topicId.
          topicId: willCreateNewTopic ? undefined : (topicId ?? undefined),
          topicFilter: this.#getTopicFilter(
            topicListAgentId,
            operationContext.groupId ?? undefined,
          ),
          topicPageSize: systemStatusSelectors.topicPageSize(useGlobalStore.getState()),
          threadId: operationContext.threadId ?? undefined,
          // Support creating new thread along with message
          newThread: newThread
            ? {
                sourceMessageId: newThread.sourceMessageId,
                type: newThread.type,
              }
            : undefined,
          newTopic: willCreateNewTopic
            ? {
                ...newTopicModelSnapshot,
                // Same id the optimistic sidebar row already uses.
                id: optimisticTopic?.id,
                topicMessageIds: forceNewTopicFromExisting ? [] : messages.map((m) => m.id),
                title: newTopicTitle,
              }
            : undefined,
          agentId: operationContext.agentId,
          // Pass groupId for group chat scenarios
          groupId: operationContext.groupId ?? undefined,
          newAssistantMessage: {
            agentId: directMentionRoute ? agentId : undefined,
            id: tempAssistantId,
            // Pass isSupervisor metadata for group orchestration
            metadata: operationContext.isSupervisor
              ? { isSupervisor: true, orchestrationRole: 'supervisor' as const }
              : undefined,
            model,
            provider: provider!,
          },
        },
        abortController,
      );
      notifyMessageAccepted();
      const responseMeta = data as SendMessageServerResponseMeta;
      // Use created topicId/threadId if available, otherwise use original from context
      let finalTopicId = data.topicId ?? operationContext.topicId;
      const finalThreadId = data.createdThreadId ?? operationContext.threadId;
      const isCreateNewTopic = isCreatedTopicResponse(data);

      // refresh the total data
      if (data?.topics) {
        finalTopicId = data.topicId;

        // Skip ingesting the returned topic list into the main chat's Projection index
        // when the caller owns an isolated topic scope (e.g. Task Manager panel).
        // Otherwise the newly created isolated-trigger topic would flash in the
        // main sidebar until the next SWR revalidation filters it out.
        if (!context.isolatedTopic) {
          if (optimisticTopic && optimisticTopicActive && data.topicId) {
            resolveOptimisticTopic(data.topicId, newTopicTitle);
          }
          const pageSize = systemStatusSelectors.topicPageSize(useGlobalStore.getState());
          this.#get().internal_updateTopics(topicListAgentId, {
            groupId: operationContext.groupId,
            items: data.topics.items,
            pageSize,
            total: data.topics.total,
          });

          // Record the created topicId in metadata (not context)
          this.#get().updateOperationMetadata(operationId, { createdTopicId: data.topicId });
        }
      } else if (isCreateNewTopic && data.topicId && !context.isolatedTopic) {
        resolveOptimisticTopic(data.topicId, newTopicTitle);
        this.#get().updateOperationMetadata(operationId, { createdTopicId: data.topicId });
        void Promise.resolve(this.#get().refreshTopic()).catch(console.error);
      } else if (operationContext.topicId) {
        // Optimistically bump the sort key (`sortUpdatedAt`, the sidebar's activity-time
        // sort/group key) so the topic jumps to the top immediately, before the SWR
        // refetch returns the server's fresh `topicActivityAt`. Bumping `updatedAt` here
        // would no longer reorder anything — the sidebar sorts by `sortUpdatedAt`.
        this.#get().internal_dispatchTopic({
          type: 'updateTopic',
          id: operationContext.topicId,
          value: { sortUpdatedAt: Date.now() },
        });
      }

      // Record created threadId in operation metadata
      if (data.createdThreadId) {
        this.#get().updateOperationMetadata(operationId, { createdThreadId: data.createdThreadId });

        // When the active portal view is already the Thread surface (the
        // main-page "create subtopic" flow staged it before sending), pivot it
        // from `isNew` → persisted thread id. Otherwise the thread was started
        // by a panel-hosted ConversationProvider (e.g. FloatingChatPanel inside
        // the Document portal) and we must NOT push a Thread view — doing so
        // would cover the host view the user is still reading.
        const currentPortalViewType = chatPortalSelectors.currentViewType(this.#get());
        if (currentPortalViewType === PortalViewType.Thread) {
          this.#get().openThreadInPortal(data.createdThreadId, context.sourceMessageId);
        } else {
          this.#get().syncThreadInPortal(data.createdThreadId, context.sourceMessageId);
        }

        // Refresh threads list to update the sidebar
        this.#get().refreshThreads();
      }

      // Create final context with updated topicId/threadId from server response
      const finalContext = {
        ...operationContext,
        isNew: data.createdThreadId || isCreateNewTopic ? false : operationContext.isNew,
        threadId: finalThreadId,
        topicId: finalTopicId,
      };
      const finalMessageKey = messageMapKey(finalContext);
      this.#get().moveQueuedMessages(currentContextKey, finalMessageKey);
      getFileStoreState().moveChatContextSelections(currentContextKey, finalMessageKey);
      // Legacy queue location: follow-ups enqueued behind an op still
      // registered under the pre-mint `_new` key.
      if (willCreateNewTopic)
        this.#get().moveQueuedMessages(
          messageMapKey({ ...operationContext, topicId: null }),
          finalMessageKey,
        );
      this.#get().moveVoiceMessages(operationContext, finalContext);
      const persistedMessages = attachSendTimeMetadataToUserMessage(
        data.messages,
        data.userMessageId,
        userMessageMetadata,
      );
      data = {
        ...data,
        messages: responseMeta.__isPartialMessages
          ? mergePartialPersistedMessages(
              this.#get().messagesMap[finalMessageKey] || [],
              persistedMessages,
              [tempId, tempAssistantId],
            )
          : persistedMessages,
      };

      this.#get().replaceMessages(data.messages, {
        context: finalContext,
        action: 'sendMessage/serverResponse',
      });

      if (isCreateNewTopic && data.topicId) {
        if (context.isolatedTopic) {
          // Notify the isolated caller immediately so its UI re-subscribes to
          // the new topic key and picks up the streaming AI response.
          await onTopicCreated?.(data.topicId);
        } else {
          // clearNewKey: true ensures the _new key data is cleared after topic creation
          await this.#get().switchTopic(data.topicId, {
            clearNewKey: true,
            skipRefreshMessage: true,
          });
        }
      }
    } catch (e) {
      console.error(e);
      rollbackOptimisticTopic('sendMessage/rollbackOptimisticTopic');
      // Fail operation on error
      if (this.#get().operations[operationId]?.status !== 'cancelled') {
        this.#get().failOperation(operationId, {
          type: e instanceof Error ? e.name : 'unknown_error',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }

      if (!preserveComposer && e instanceof TRPCClientError) {
        const isAbort = e.message.includes('aborted') || e.name === 'AbortError';
        // Check if error is due to cancellation
        if (!isAbort) {
          this.#get().updateOperationMetadata(operationId, { inputSendErrorMsg: e.message });
          const op = this.#get().operations[operationId];
          if (op?.metadata.inputEditorTempState) {
            targetInputEditor?.setJSONState(op.metadata.inputEditorTempState);
          } else {
            targetInputEditor?.setDocument('markdown', message);
          }
        }
      }
    } finally {
      // Roll the optimistic pair back only when the send did not land (cancel or
      // failure). On success there is nothing to clean up: the rows were created
      // under the ids the server persisted, so `replaceMessages` reconciled them
      // in place — and for a brand-new topic `switchTopic({ clearNewKey: true })`
      // drops the now-empty `_new` bucket anyway.
      if (!data)
        cleanupTempMessages({
          preserveOptimisticUser: Boolean(optimisticUserMessageId && !hasNotifiedMessageAccepted),
        });
    }

    // Clear editor temp state after message created
    if (data) {
      this.#get().updateOperationMetadata(operationId, { inputEditorTempState: null });
    }

    if (!data) {
      detachUnacceptedCallerAbort();
      rollbackOptimisticTopic('sendMessage/rollbackOptimisticTopic');
      restoreUnacceptedVoiceMessageContext();
      return;
    }

    rollbackOptimisticTopic('sendMessage/rollbackUnresolvedOptimisticTopic');

    if (abortController.signal.aborted) {
      this.#get().completeOperation(operationId);
      notifyMessagePersisted();

      return {
        assistantMessageId: data.assistantMessageId,
        createdThreadId: data.createdThreadId,
        createdTopicId: isCreatedTopicResponse(data) ? data.topicId : undefined,
        userMessageId: data.userMessageId,
      };
    }
    // Topic title auto-generation, now via the shared `afterUserMessagePersisted`
    // hook. The client passes its freshly-created `data.messages`
    // (not yet in the store under the real topicId); gateway/hetero call the same
    // hook from their branches and let it read the persisted conversation.
    void sendRunLifecycle
      .afterUserMessagePersisted({
        assistantMessageId: data.assistantMessageId,
        context: operationContext,
        isCreateNewTopic: isCreatedTopicResponse(data),
        messages: data.messages,
        operationId,
        runId: operationId,
        runScope: sendRunScope,
        runtimeType,
        topicId: data.topicId,
      })
      .catch(console.error);

    const execContext = {
      ...operationContext,
      // The persisted topic/thread is now the identity of this conversation.
      // Clear the draft marker before creating the child runtime operation so
      // Stop from the re-rendered ConversationProvider matches it.
      isNew: data.createdThreadId || isCreatedTopicResponse(data) ? false : operationContext.isNew,
      topicId: data.topicId ?? operationContext.topicId,
      threadId: data.createdThreadId ?? operationContext.threadId,
    };

    // ── Auto-dismiss pending tool interventions ──
    // Uses direct dispatch (updateMessage) instead of optimisticUpdatePlugin because
    // agent runtime checks pluginIntervention.status, not plugin.intervention.status.
    {
      const msgs = displayMessageSelectors.getDisplayMessagesByKey(messageMapKey(execContext))(
        this.#get(),
      );

      const pendingToolMsgIds = msgs.flatMap((m) => {
        const ids: string[] = [];
        if (m.role === 'tool' && m.pluginIntervention?.status === 'pending') ids.push(m.id);

        const childIds =
          m.children?.flatMap((child) =>
            (child.tools ?? [])
              .filter((t) => t.intervention?.status === 'pending' && t.result_msg_id)
              .map((t) => t.result_msg_id!),
          ) ?? [];

        return [...ids, ...childIds];
      });

      for (const msgId of pendingToolMsgIds) {
        this.#get().internal_dispatchMessage({
          id: msgId,
          type: 'updateMessage',
          value: {
            pluginIntervention: { status: 'aborted' },
            content: 'User bypassed this interaction by sending a message directly.',
          },
        });
        void messageService.updateMessagePlugin(
          msgId,
          { intervention: { status: 'aborted' } },
          {
            agentId: execContext.agentId,
            groupId: execContext.groupId,
            threadId: execContext.threadId,
            topicId: execContext.topicId,
          },
        );
      }
    }

    // ── AI execution (client mode) ──
    {
      let sendOperationHandedOff = false;
      const handoffSendOperation = () => {
        if (sendOperationHandedOff) return;

        sendOperationHandedOff = true;
        // Keep the send operation running until the child runtime is ready to start. This makes
        // `_new` → persisted-topic migration one continuous queue barrier for follow-up turns.
        this.#get().completeOperation(operationId);
        notifyMessagePersisted();
      };

      try {
        if (directMentionRoute) {
          const directMentionRun = executeDirectMention(
            {
              context: execContext,
              instruction: message,
              parentOperationId: operationId,
              runtimeType: runtimeType === 'gateway' ? 'gateway' : 'client',
              sourceMessageId: data.assistantMessageId,
              targetAgentId: agentId,
            },
            this.#get,
          );
          handoffSendOperation();
          await directMentionRun;
        } else {
          const displayMessages = displayMessageSelectors
            .getDisplayMessagesByKey(messageMapKey(execContext))(this.#get())
            .filter((item) => !isLocalOnlyMessage(item));

          // When agents are @mentioned, inject a slim callAgent-only manifest
          // so the AI can delegate directly without activating the full agent-management tool
          const injectedManifests = hasMentionedAgents ? [createCallAgentManifest()] : undefined;
          const activeTopicDocumentInitialContext =
            await resolveActiveTopicDocumentInitialContext(execContext);

          const hasInitialContext = hasMentionedAgents || !!injectedManifests;

          // Note: selectedSkills and selectedTools are NOT passed here — they are
          // persisted into the user message content above so they survive across
          // turns without re-injection.
          const agentRuntimeInitialContext = hasInitialContext
            ? {
                initialContext: {
                  // Only inject mentionedAgents in non-group context to avoid
                  // group @member mentions (including ALL_MEMBERS) leaking into agent-management
                  ...(hasMentionedAgents ? { mentionedAgents } : undefined),
                  ...(injectedManifests ? { injectedManifests } : undefined),
                },
                phase: 'init' as const,
              }
            : undefined;
          const mergedAgentRuntimeInitialContext = mergeAgentRuntimeInitialContexts(
            activeTopicDocumentInitialContext,
            agentRuntimeInitialContext,
          );

          const clientRun = executeClientAgent({
            context: execContext,
            initialContext: mergedAgentRuntimeInitialContext,
            metadata: requestMetadata,
            messages: displayMessages,
            parentMessageId: data.assistantMessageId,
            parentMessageType: 'assistant',
            parentOperationId: operationId,
            inPortalThread: !!data.createdThreadId,
            skipCreateFirstMessage: true,
            userMessageId: data.userMessageId,
          });
          handoffSendOperation();
          await clientRun;
        }

        const userFiles = dbMessageSelectors
          .dbUserFiles(this.#get())
          .map((f) => f?.id)
          .filter(Boolean) as string[];

        if (userFiles.length > 0) {
          await getAgentStoreState().addFilesToAgent(userFiles, false);
        }
      } catch (e) {
        console.error(e);
      } finally {
        handoffSendOperation();
      }
    }

    // Return result for callers who need message IDs
    return {
      assistantMessageId: data.assistantMessageId,
      createdThreadId: data.createdThreadId,
      createdTopicId: isCreatedTopicResponse(data) ? data.topicId : undefined,
      userMessageId: data.userMessageId,
    };
  };

  /**
   * Execute context compression for /compact command.
   * Reuses the same service methods as the agent runtime's compress_context executor.
   */
  executeCompression = async (
    context: Record<string, any>,
    parentOperationId: string,
  ): Promise<void> => {
    const { agentId, topicId } = context;
    if (!topicId) return;

    const contextKey = messageMapKey(context as any);
    const dbMessages = dbMessageSelectors.getDbMessagesByKey(contextKey)(this.#get()) || [];
    const messageIds = getCompressionCandidateMessageIds(dbMessages);

    if (messageIds.length === 0) return;

    const tempId = 'tmp_compress_' + nanoid();
    const { abortController, operationId } = this.#get().startOperation({
      context: { ...context, messageId: tempId },
      parentOperationId,
      type: 'contextCompression',
    });

    // Immediate UI feedback: render a pending compressed group from the first frame
    this.#get().internal_dispatchMessage(
      {
        id: tempId,
        type: 'createMessage',
        value: createPendingCompressedGroup({
          agentId,
          groupId: context.groupId,
          id: tempId,
          threadId: context.threadId,
          topicId,
        }) as any,
      },
      { operationId },
    );

    try {
      // 1. Create compression group on server
      const result = await messageService.createCompressionGroup({
        agentId,
        messageIds,
        topicId,
      });
      const { messageGroupId, messages: serverMessages, messagesToSummarize } = result;

      // Replace local pending group with server compression group
      this.#get().replaceMessages(serverMessages, { context: context as any });
      this.#get().associateMessageWithOperation(messageGroupId, operationId);

      // 2. Generate summary via LLM
      const { model = DEFAULT_MODEL, provider = DEFAULT_PROVIDER } =
        getAgentProjectionById(agentId) ?? {};
      const compressionPayload = chainCompressContext(messagesToSummarize);
      let summaryContent = '';

      await chatService.fetchPresetTaskResult({
        abortController,
        onMessageHandle: (chunk) => {
          if (chunk.type === 'text') {
            summaryContent += chunk.text || '';
            this.#get().internal_dispatchMessage(
              { id: messageGroupId, type: 'updateMessage', value: { content: summaryContent } },
              { operationId },
            );
          }
        },
        params: { ...compressionPayload, model, provider },
      });

      if (abortController.signal.aborted) throw createAbortError();

      // 3. Finalize compression
      const finalResult = await messageService.finalizeCompression({
        agentId,
        content: summaryContent,
        messageGroupId,
        topicId,
      });

      if (finalResult.messages) {
        this.#get().replaceMessages(finalResult.messages, { context: context as any });
      }

      this.#get().completeOperation(operationId);
    } catch (error) {
      if (isAbortError(error, abortController)) {
        this.#get().internal_dispatchMessage(
          { type: 'deleteMessages', ids: [tempId] },
          { operationId },
        );
        return;
      }

      console.error('[/compact] Compression failed:', error);
      this.#get().internal_dispatchMessage(
        { type: 'deleteMessages', ids: [tempId] },
        { operationId },
      );
      this.#get().failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'compression_failed',
      });
    }
  };
}

export type ConversationLifecycleAction = Pick<
  ConversationLifecycleActionImpl,
  keyof ConversationLifecycleActionImpl
>;
