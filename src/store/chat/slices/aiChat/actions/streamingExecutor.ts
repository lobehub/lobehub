/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import {
  AgentRuntime,
  type AgentRuntimeContext,
  type AgentState,
  GeneralChatAgent,
  computeStepContext,
} from '@lobechat/agent-runtime';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { isDesktop } from '@lobechat/const';
import {
  type ChatImageItem,
  type ChatToolPayload,
  type ConversationContext,
  type MessageContentPart,
  type MessageMapScope,
  type MessageToolCall,
  type ModelUsage,
  type RuntimeInitialContext,
  type RuntimeStepContext,
  TraceNameMap,
  type UIChatMessage,
} from '@lobechat/types';
import { serializePartsForStorage } from '@lobechat/utils';
import debug from 'debug';
import { throttle } from 'es-toolkit/compat';
import { t } from 'i18next';
import pMap from 'p-map';
import { type StateCreator } from 'zustand/vanilla';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { chatService } from '@/services/chat';
import { resolveAgentConfig } from '@/services/chat/mecha';
import { messageService } from '@/services/message';
import { createAgentExecutors } from '@/store/chat/agents/createAgentExecutors';
import { type ChatStore } from '@/store/chat/store';
import { getFileStoreState } from '@/store/file/store';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';
import { toolInterventionSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';

import { topicSelectors } from '../../../selectors';
import { cleanSpeakerTag } from '../../../utils/cleanSpeakerTag';
import { messageMapKey } from '../../../utils/messageMapKey';
import { selectTodosFromMessages } from '../../message/selectors/dbMessage';

const log = debug('lobe-store:streaming-executor');

/**
 * Core streaming execution actions for AI chat
 */
export interface StreamingExecutorAction {
  /**
   * Creates initial agent state and context with user intervention config
   */
  internal_createAgentState: (params: {
    messages: UIChatMessage[];
    parentMessageId: string;
    /**
     * Explicit agentId for this execution (avoids using global activeAgentId)
     */
    agentId?: string;
    /**
     * Explicit topicId for this execution (avoids using global activeTopicId)
     */
    topicId?: string | null;
    threadId?: string;
    operationId?: string;
    initialState?: AgentState;
    initialContext?: AgentRuntimeContext;
    /**
     * Sub Agent ID for group orchestration scenarios
     * Used to get Agent config (model, provider, plugins) instead of agentId
     */
    subAgentId?: string;
  }) => {
    state: AgentState;
    context: AgentRuntimeContext;
  };
  /**
   * Retrieves an AI-generated chat message from the backend service with streaming
   */
  internal_fetchAIChatMessage: (params: {
    messageId: string;
    messages: UIChatMessage[];
    model: string;
    provider: string;
    operationId?: string;
    agentConfig?: any;
    traceId?: string;
    /** Initial context for page editor (captured at operation start) */
    initialContext?: RuntimeInitialContext;
    /** Step context for page editor (updated each step) */
    stepContext?: RuntimeStepContext;
  }) => Promise<{
    isFunctionCall: boolean;
    tools?: ChatToolPayload[];
    tool_calls?: MessageToolCall[];
    content: string;
    traceId?: string;
    finishType?: string;
    usage?: ModelUsage;
  }>;
  /**
   * Executes the core processing logic for AI messages
   * including preprocessing and postprocessing steps
   */
  internal_execAgentRuntime: (params: {
    /**
     * Full conversation context (required)
     * Contains agentId, topicId, threadId, groupId, scope, etc.
     */
    context: ConversationContext;
    /**
     * Initial agent runtime context (for resuming execution from a specific phase)
     */
    initialContext?: AgentRuntimeContext;
    /**
     * Initial agent state (for resuming execution from a specific point)
     */
    initialState?: AgentState;
    inPortalThread?: boolean;
    inSearchWorkflow?: boolean;
    messages: UIChatMessage[];
    /**
     * Operation ID for this execution (automatically created if not provided)
     */
    operationId?: string;
    parentMessageId: string;
    parentMessageType: 'user' | 'assistant' | 'tool';
    /**
     * Parent operation ID (creates a child operation if provided)
     */
    parentOperationId?: string;
    skipCreateFirstMessage?: boolean;
  }) => Promise<void>;
}

export const streamingExecutor: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  StreamingExecutorAction
> = (set, get) => ({
  internal_createAgentState: ({
    messages,
    parentMessageId,
    agentId: paramAgentId,
    topicId: paramTopicId,
    threadId,
    initialState,
    initialContext,
    operationId,
    subAgentId: paramSubAgentId,
  }) => {
    // Use provided agentId/topicId or fallback to global state
    const { activeAgentId, activeTopicId } = get();
    const agentId = paramAgentId ?? activeAgentId;
    const topicId = paramTopicId !== undefined ? paramTopicId : activeTopicId;

    // For group orchestration scenarios:
    // - subAgentId is used for agent config retrieval (model, provider, plugins)
    // - agentId is used for session ID (message storage location)
    const effectiveAgentId = paramSubAgentId || agentId;

    // Get scope from operation context if available
    const operation = operationId ? get().operations[operationId] : undefined;
    const scope = operation?.context.scope;

    console.log('[internal_createAgentState] Operation scope:', { operationId, scope });

    // Resolve agent config with builtin agent runtime config merged
    // This ensures runtime plugins (e.g., 'lobe-agent-builder' for Agent Builder) are included
    const { agentConfig: agentConfigData, plugins: pluginIds } = resolveAgentConfig({
      agentId: effectiveAgentId || '',
      scope, // Pass scope from operation context
    });

    // Get tools manifest map
    const toolsEngine = createAgentToolsEngine({
      model: agentConfigData.model,
      provider: agentConfigData.provider!,
    });
    const { enabledToolIds } = toolsEngine.generateToolsDetailed({
      model: agentConfigData.model,
      provider: agentConfigData.provider!,
      toolIds: pluginIds,
    });
    const toolManifestMap = Object.fromEntries(
      toolsEngine.getEnabledPluginManifests(enabledToolIds).entries(),
    );

    // Get user intervention config
    const userStore = getUserStoreState();
    const userInterventionConfig = {
      approvalMode: toolInterventionSelectors.approvalMode(userStore),
      allowList: toolInterventionSelectors.allowList(userStore),
    };

    // Create initial state or use provided state
    const state =
      initialState ||
      AgentRuntime.createInitialState({
        operationId: operationId ?? agentId,
        messages,
        maxSteps: 400,
        metadata: {
          sessionId: agentId,
          topicId,
          threadId,
        },
        toolManifestMap,
        userInterventionConfig,
      });

    // Build initialContext for page editor if lobe-page-agent is enabled
    let runtimeInitialContext: RuntimeInitialContext | undefined;

    if (enabledToolIds.includes(PageAgentIdentifier)) {
      try {
        // Get page content context from page agent runtime
        const pageContentContext = pageAgentRuntime.getPageContentContext('both');

        runtimeInitialContext = {
          pageEditor: {
            markdown: pageContentContext.markdown || '',
            xml: pageContentContext.xml || '',
            metadata: {
              title: pageContentContext.metadata.title,
              charCount: pageContentContext.metadata.charCount,
              lineCount: pageContentContext.metadata.lineCount,
            },
          },
        };
        log(
          '[internal_createAgentState] Page Agent detected, injected initialContext.pageEditor with title: %s',
          pageContentContext.metadata.title,
        );
      } catch (error) {
        // Page agent runtime may not be initialized (e.g., editor not set)
        // This is expected in some scenarios, so we just log and continue
        log('[internal_createAgentState] Failed to get page content context: %o', error);
      }
    }

    // Create initial context or use provided context
    const context: AgentRuntimeContext = initialContext || {
      phase: 'init',
      payload: {
        model: agentConfigData.model,
        provider: agentConfigData.provider,
        parentMessageId,
      },
      session: {
        sessionId: agentId,
        messageCount: messages.length,
        status: state.status,
        stepCount: 0,
      },
      // Inject initialContext if available
      initialContext: runtimeInitialContext,
    };

    return { state, context };
  },

  internal_fetchAIChatMessage: async ({
    messageId,
    messages,
    model,
    provider,
    operationId,
    agentConfig,
    traceId: traceIdParam,
    initialContext,
    stepContext,
  }) => {
    const {
      optimisticUpdateMessageContent,
      internal_dispatchMessage,
      internal_toggleToolCallingStreaming,
    } = get();

    // Get agentId, topicId, groupId and abortController from operation
    let agentId: string;
    let subAgentId: string | undefined;
    let topicId: string | null | undefined;
    let threadId: string | undefined;
    let groupId: string | undefined;
    let scope: MessageMapScope | undefined;
    let traceId: string | undefined = traceIdParam;
    let abortController: AbortController;

    if (operationId) {
      const operation = get().operations[operationId];
      if (!operation) {
        log('[internal_fetchAIChatMessage] ERROR: Operation not found: %s', operationId);
        throw new Error(`Operation not found: ${operationId}`);
      }
      agentId = operation.context.agentId!;
      subAgentId = operation.context.subAgentId;
      topicId = operation.context.topicId;
      threadId = operation.context.threadId ?? undefined;
      groupId = operation.context.groupId;
      scope = operation.context.scope;
      abortController = operation.abortController; // 👈 Use operation's abortController
      log(
        '[internal_fetchAIChatMessage] get context from operation %s: agentId=%s, subAgentId=%s, topicId=%s, groupId=%s, aborted=%s',
        operationId,
        agentId,
        subAgentId,
        topicId,
        groupId,
        abortController.signal.aborted,
      );
      // Get traceId from operation metadata if not explicitly provided
      if (!traceId) {
        traceId = operation.metadata?.traceId;
      }
    } else {
      // Fallback to global state (for legacy code paths without operation)
      agentId = get().activeAgentId;
      topicId = get().activeTopicId;
      groupId = get().activeGroupId;
      abortController = new AbortController();
      log(
        '[internal_fetchAIChatMessage] use global context: agentId=%s, topicId=%s, groupId=%s',
        agentId,
        topicId,
        groupId,
      );
    }

    // Create base context for child operations and message queries
    const fetchContext = { agentId, topicId, threadId, groupId, scope };

    // For group orchestration scenarios:
    // - subAgentId is used for agent config retrieval (model, provider, plugins)
    // - agentId is used for session ID (message storage location)
    const effectiveAgentId = subAgentId || agentId;

    // Resolve agent config with params adjusted based on chatConfig
    // If agentConfig is passed in, use it directly (it's already resolved)
    // Otherwise, resolve from mecha layer which handles:
    // - Builtin agent runtime config merging
    // - max_tokens/reasoning_effort based on chatConfig settings
    const resolved = resolveAgentConfig({
      agentId: effectiveAgentId,
      scope, // scope is already available from line 329
    });
    const finalAgentConfig = agentConfig || resolved.agentConfig;
    const chatConfig = resolved.chatConfig;

    let isFunctionCall = false;
    let tools: ChatToolPayload[] | undefined;
    let tool_calls: MessageToolCall[] | undefined;
    let finalUsage;
    let msgTraceId: string | undefined;
    let output = '';

    let thinkingContent = '';
    let thinkingStartAt: number;
    let thinkingDuration: number | undefined;
    let reasoningOperationId: string | undefined;
    let finishType: string | undefined;
    // to upload image
    const uploadTasks: Map<string, Promise<{ id?: string; url?: string }>> = new Map();

    // Multimodal content parts
    let contentParts: MessageContentPart[] = [];
    let reasoningParts: MessageContentPart[] = [];
    const contentImageUploads: Map<number, Promise<string>> = new Map();
    const reasoningImageUploads: Map<number, Promise<string>> = new Map();

    // Throttle tool_calls updates to prevent excessive re-renders (max once per 300ms)
    const throttledUpdateToolCalls = throttle(
      (toolCalls: MessageToolCall[]) => {
        internal_dispatchMessage(
          {
            id: messageId,
            type: 'updateMessage',
            value: { tools: get().internal_transformToolCalls(toolCalls) },
          },
          { operationId },
        );
      },
      300,
      { leading: true, trailing: true },
    );

    const historySummary = chatConfig.enableCompressHistory
      ? topicSelectors.currentActiveTopicSummary(get())
      : undefined;
    await chatService.createAssistantMessageStream({
      abortController,
      params: {
        // Use effectiveAgentId for agent config resolution (system role, tools, etc.)
        // In group orchestration: subAgentId for the actual speaking agent
        // In normal chat: agentId for the main agent
        agentId: effectiveAgentId || undefined,
        groupId,
        messages,
        model,
        provider,
        scope, // Pass scope to chat service for page-agent injection
        ...finalAgentConfig.params,
        plugins: finalAgentConfig.plugins,
      },
      historySummary: historySummary?.content,
      // Pass page editor context from agent runtime
      initialContext,
      stepContext,
      trace: {
        traceId,
        topicId: topicId ?? undefined,
        traceName: TraceNameMap.Conversation,
      },
      onErrorHandle: async (error) => {
        log(
          '[internal_fetchAIChatMessage] onError: messageId=%s, error=%s, operationId=%s',
          messageId,
          error.message,
          operationId,
        );
        await get().optimisticUpdateMessageError(messageId, error, { operationId });
      },
      onFinish: async (
        content,
        { traceId, observationId, toolCalls, reasoning, grounding, usage, speed, type },
      ) => {
        // if there is traceId, update it
        if (traceId) {
          msgTraceId = traceId;
          messageService.updateMessage(
            messageId,
            { traceId, observationId: observationId ?? undefined },
            { agentId, groupId, topicId },
          );
        }

        // 等待所有图片上传完成
        let finalImages: ChatImageItem[] = [];

        if (uploadTasks.size > 0) {
          try {
            // 等待所有上传任务完成
            const uploadResults = await pMap(Array.from(uploadTasks.values()), (task) => task, {
              concurrency: 5,
            });

            // 使用上传后的 S3 URL 替换原始图像数据
            finalImages = uploadResults.filter((i) => !!i.url) as ChatImageItem[];
          } catch (error) {
            console.error('Error waiting for image uploads:', error);
          }
        }

        // Wait for all multimodal image uploads to complete
        // Note: Arrays are already updated in-place when uploads complete
        // Use Promise.allSettled to continue even if some uploads fail
        await Promise.allSettled([
          ...Array.from(contentImageUploads.values()),
          ...Array.from(reasoningImageUploads.values()),
        ]);

        let parsedToolCalls = toolCalls;
        if (parsedToolCalls && parsedToolCalls.length > 0) {
          // Flush any pending throttled updates before finalizing
          throttledUpdateToolCalls.flush();
          internal_toggleToolCallingStreaming(messageId, undefined);

          tool_calls = toolCalls;

          parsedToolCalls = parsedToolCalls.map((item) => ({
            ...item,
            function: {
              ...item.function,
              arguments: !!item.function.arguments ? item.function.arguments : '{}',
            },
          }));

          tools = get().internal_transformToolCalls(parsedToolCalls);

          isFunctionCall = true;
        }

        finalUsage = usage;
        finishType = type;

        log(
          '[internal_fetchAIChatMessage] onFinish: messageId=%s, finishType=%s, operationId=%s',
          messageId,
          type,
          operationId,
        );

        // Check if there are any image parts
        const hasContentImages = contentParts.some((part) => part.type === 'image');
        const hasReasoningImages = reasoningParts.some((part) => part.type === 'image');

        // Determine final content
        // If has images, serialize contentParts; otherwise use accumulated output text
        const finalContent = hasContentImages ? serializePartsForStorage(contentParts) : output;

        const finalDuration =
          thinkingDuration && !isNaN(thinkingDuration) ? thinkingDuration : undefined;

        // Determine final reasoning content
        // Priority: reasoningParts (multimodal) > thinkingContent (from reasoning_part text) > reasoning (from old reasoning event)
        let finalReasoning: any = undefined;
        if (hasReasoningImages) {
          // Has images, use multimodal format
          finalReasoning = {
            content: serializePartsForStorage(reasoningParts),
            duration: finalDuration,
            isMultimodal: true,
          };
        } else if (thinkingContent) {
          // Has text from reasoning_part but no images
          finalReasoning = {
            content: thinkingContent,
            duration: finalDuration,
          };
        } else if (reasoning?.content) {
          // Fallback to old reasoning event content
          finalReasoning = {
            ...reasoning,
            duration: finalDuration,
          };
        }

        // update the content after fetch result
        await optimisticUpdateMessageContent(
          messageId,
          finalContent,
          {
            tools,
            reasoning: finalReasoning,
            search: !!grounding?.citations ? grounding : undefined,
            imageList: finalImages.length > 0 ? finalImages : undefined,
            metadata: {
              ...usage,
              ...speed,
              performance: speed,
              usage,
              finishType: type,
              ...(hasContentImages && { isMultimodal: true }),
            },
          },
          { operationId },
        );
      },
      onMessageHandle: async (chunk) => {
        switch (chunk.type) {
          case 'grounding': {
            // if there is no citations, then stop
            if (
              !chunk.grounding ||
              !chunk.grounding.citations ||
              chunk.grounding.citations.length <= 0
            )
              return;

            internal_dispatchMessage(
              {
                id: messageId,
                type: 'updateMessage',
                value: {
                  search: {
                    citations: chunk.grounding.citations,
                    searchQueries: chunk.grounding.searchQueries,
                  },
                },
              },
              { operationId },
            );
            break;
          }

          case 'base64_image': {
            internal_dispatchMessage(
              {
                id: messageId,
                type: 'updateMessage',
                value: {
                  imageList: chunk.images.map((i) => ({ id: i.id, url: i.data, alt: i.id })),
                },
              },
              { operationId },
            );
            const image = chunk.image;

            const task = getFileStoreState()
              .uploadBase64FileWithProgress(image.data)
              .then((value) => ({
                id: value?.id,
                url: value?.url,
                alt: value?.filename || value?.id,
              }));

            uploadTasks.set(image.id, task);

            break;
          }

          case 'text': {
            output += chunk.text;

            // Clean speaker tag that may be reproduced by model in group chat
            // The tag is injected at message start to identify sender, but models may copy it
            output = cleanSpeakerTag(output);

            // if there is no duration, it means the end of reasoning
            if (!thinkingDuration) {
              thinkingDuration = Date.now() - thinkingStartAt;

              // Complete reasoning operation if it exists
              if (reasoningOperationId) {
                get().completeOperation(reasoningOperationId);
                reasoningOperationId = undefined;
              }
            }

            log(
              '[text stream] messageId=%s, output length=%d, operationId=%s',
              messageId,
              output.length,
              operationId,
            );

            internal_dispatchMessage(
              {
                id: messageId,
                type: 'updateMessage',
                value: {
                  content: output,
                  reasoning: !!thinkingContent
                    ? { content: thinkingContent, duration: thinkingDuration }
                    : undefined,
                },
              },
              { operationId },
            );
            break;
          }

          case 'reasoning': {
            // if there is no thinkingStartAt, it means the start of reasoning
            if (!thinkingStartAt) {
              thinkingStartAt = Date.now();

              // Create reasoning operation
              const { operationId: reasoningOpId } = get().startOperation({
                type: 'reasoning',
                context: { ...fetchContext, messageId },
                parentOperationId: operationId,
              });
              reasoningOperationId = reasoningOpId;

              // Associate message with reasoning operation
              get().associateMessageWithOperation(messageId, reasoningOperationId);
            }

            thinkingContent += chunk.text;

            internal_dispatchMessage(
              {
                id: messageId,
                type: 'updateMessage',
                value: { reasoning: { content: thinkingContent } },
              },
              { operationId },
            );
            break;
          }

          case 'reasoning_part': {
            // Start reasoning if not started
            if (!thinkingStartAt) {
              thinkingStartAt = Date.now();

              const { operationId: reasoningOpId } = get().startOperation({
                type: 'reasoning',
                context: { ...fetchContext, messageId },
                parentOperationId: operationId,
              });
              reasoningOperationId = reasoningOpId;
              get().associateMessageWithOperation(messageId, reasoningOperationId);
            }

            const { partType, content: partContent, mimeType } = chunk;

            if (partType === 'text') {
              const lastPart = reasoningParts.at(-1);

              // If last part is also text, merge chunks together
              if (lastPart?.type === 'text') {
                reasoningParts = [
                  ...reasoningParts.slice(0, -1),
                  { type: 'text', text: lastPart.text + partContent },
                ];
              } else {
                // Create new text part (first chunk, may contain thoughtSignature)
                reasoningParts = [...reasoningParts, { type: 'text', text: partContent }];
              }
              thinkingContent += partContent;
            } else if (partType === 'image') {
              // Image part - create new array to avoid mutation
              const tempImage = `data:${mimeType};base64,${partContent}`;
              const partIndex = reasoningParts.length;
              const newPart: MessageContentPart = { type: 'image', image: tempImage };
              reasoningParts = [...reasoningParts, newPart];

              // Start upload task and update array when done
              const uploadTask = getFileStoreState()
                .uploadBase64FileWithProgress(tempImage)
                .then((file) => {
                  const url = file?.url || tempImage;
                  // Replace the part at index by creating a new array
                  const updatedParts = [...reasoningParts];
                  updatedParts[partIndex] = { type: 'image', image: url };
                  reasoningParts = updatedParts;
                  return url;
                })
                .catch((error) => {
                  console.error('[reasoning_part] Image upload failed:', error);
                  return tempImage;
                });

              reasoningImageUploads.set(partIndex, uploadTask);
            }

            // Real-time update with display format
            // Check if there are any image parts to determine if it's multimodal
            const hasReasoningImages = reasoningParts.some((part) => part.type === 'image');

            internal_dispatchMessage(
              {
                id: messageId,
                type: 'updateMessage',
                value: {
                  reasoning: hasReasoningImages
                    ? { tempDisplayContent: reasoningParts, isMultimodal: true }
                    : { content: thinkingContent },
                },
              },
              { operationId },
            );
            break;
          }

          case 'content_part': {
            const { partType, content: partContent, mimeType } = chunk;

            // End reasoning when content starts
            if (!thinkingDuration && reasoningOperationId) {
              thinkingDuration = Date.now() - thinkingStartAt;
              get().completeOperation(reasoningOperationId);
              reasoningOperationId = undefined;
            }

            if (partType === 'text') {
              const lastPart = contentParts.at(-1);

              // If last part is also text, merge chunks together
              if (lastPart?.type === 'text') {
                contentParts = [
                  ...contentParts.slice(0, -1),
                  { type: 'text', text: lastPart.text + partContent },
                ];
              } else {
                // Create new text part (first chunk, may contain thoughtSignature)
                contentParts = [...contentParts, { type: 'text', text: partContent }];
              }
              output += partContent;

              // Clean speaker tag that may be reproduced by model in group chat
              output = cleanSpeakerTag(output);
            } else if (partType === 'image') {
              // Image part - create new array to avoid mutation
              const tempImage = `data:${mimeType};base64,${partContent}`;
              const partIndex = contentParts.length;
              const newPart: MessageContentPart = {
                type: 'image',
                image: tempImage,
              };
              contentParts = [...contentParts, newPart];

              // Start upload task and update array when done
              const uploadTask = getFileStoreState()
                .uploadBase64FileWithProgress(tempImage)
                .then((file) => {
                  const url = file?.url || tempImage;
                  // Replace the part at index by creating a new array
                  const updatedParts = [...contentParts];
                  updatedParts[partIndex] = {
                    type: 'image',
                    image: url,
                  };
                  contentParts = updatedParts;
                  return url;
                })
                .catch((error) => {
                  console.error('[content_part] Image upload failed:', error);
                  return tempImage;
                });

              contentImageUploads.set(partIndex, uploadTask);
            }

            // Real-time update with display format
            // Check if there are any image parts to determine if it's multimodal
            const hasContentImages = contentParts.some((part) => part.type === 'image');

            const hasReasoningImages = reasoningParts.some((part) => part.type === 'image');

            internal_dispatchMessage(
              {
                id: messageId,
                type: 'updateMessage',
                value: {
                  content: output,
                  reasoning: hasReasoningImages
                    ? {
                        tempDisplayContent: reasoningParts,
                        isMultimodal: true,
                        duration: thinkingDuration,
                      }
                    : !!thinkingContent
                      ? { content: thinkingContent, duration: thinkingDuration }
                      : undefined,
                  ...(hasContentImages && {
                    metadata: {
                      isMultimodal: true,
                      tempDisplayContent: serializePartsForStorage(contentParts),
                    },
                  }),
                },
              },
              { operationId },
            );
            break;
          }

          // is this message is just a tool call
          case 'tool_calls': {
            internal_toggleToolCallingStreaming(messageId, chunk.isAnimationActives);
            throttledUpdateToolCalls(chunk.tool_calls);
            isFunctionCall = true;

            // Complete reasoning operation if it exists
            if (!thinkingDuration && reasoningOperationId) {
              thinkingDuration = Date.now() - thinkingStartAt;
              get().completeOperation(reasoningOperationId);
              reasoningOperationId = undefined;
            }
            break;
          }

          case 'stop': {
            // Complete reasoning operation when receiving stop signal
            if (!thinkingDuration && reasoningOperationId) {
              thinkingDuration = Date.now() - thinkingStartAt;
              get().completeOperation(reasoningOperationId);
              reasoningOperationId = undefined;
            }
            break;
          }
        }
      },
    });

    log(
      '[internal_fetchAIChatMessage] completed: messageId=%s, finishType=%s, isFunctionCall=%s, operationId=%s',
      messageId,
      finishType,
      isFunctionCall,
      operationId,
    );

    return {
      isFunctionCall,
      traceId: msgTraceId,
      content: output,
      tools,
      usage: finalUsage,
      tool_calls,
      finishType,
    };
  },

  internal_execAgentRuntime: async (params) => {
    const { messages: originalMessages, parentMessageId, parentMessageType, context } = params;

    // Extract values from context
    const { agentId, topicId, threadId, subAgentId, groupId } = context;

    // For group orchestration scenarios:
    // - subAgentId is used for agent config retrieval (model, provider, plugins)
    // - agentId is used for message storage location (via messageMapKey)
    const effectiveAgentId = subAgentId || agentId;

    // Generate message key from context
    const messageKey = messageMapKey(context);

    // Create or use provided operation
    let operationId = params.operationId;
    if (!operationId) {
      const { operationId: newOperationId } = get().startOperation({
        type: 'execAgentRuntime',
        context: { ...context, messageId: parentMessageId },
        parentOperationId: params.parentOperationId, // Pass parent operation ID
        label: 'AI Generation',
        metadata: {
          // Mark if this operation is in thread context
          // Thread operations should not affect main window UI state
          inThread: params.inPortalThread || false,
        },
      });
      operationId = newOperationId;

      // Associate message with operation
      get().associateMessageWithOperation(parentMessageId, operationId);
    }

    log(
      '[internal_execAgentRuntime] start, operationId: %s, agentId: %s, subAgentId: %s, effectiveAgentId: %s, topicId: %s, messageKey: %s, parentMessageId: %s, parentMessageType: %s, messages count: %d',
      operationId,
      agentId,
      subAgentId,
      effectiveAgentId,
      topicId,
      messageKey,
      parentMessageId,
      parentMessageType,
      originalMessages.length,
    );

    // Create a new array to avoid modifying the original messages
    let messages = [...originalMessages];

    console.log('[internal_execAgentRuntime] Context scope:', {
      scope: context.scope,
      agentId: effectiveAgentId,
    });

    // Use effectiveAgentId to get agent config (subAgentId in group orchestration, agentId otherwise)
    // resolveAgentConfig handles:
    // - Builtin agent runtime config merging
    // - max_tokens/reasoning_effort based on chatConfig settings
    const { agentConfig: agentConfigData, chatConfig } = resolveAgentConfig({
      agentId: effectiveAgentId || '',
      scope: context.scope, // Pass scope from context parameter (available at line 883)
    });

    // Use agent config from agentId
    const model = agentConfigData.model;
    const provider = agentConfigData.provider;

    // ===========================================
    // Step 1: Knowledge Base Tool Integration
    // ===========================================
    // RAG retrieval is now handled by the Knowledge Base Tool
    // The AI will decide when to call searchKnowledgeBase and readKnowledge tools
    // based on the conversation context and available knowledge bases

    // TODO: Implement selected files full-text injection if needed
    // User-selected files should be handled differently from knowledge base files

    // ===========================================
    // Step 2: Create and Execute Agent Runtime
    // ===========================================
    log('[internal_execAgentRuntime] Creating agent runtime');

    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 1000 },
      operationId: `${messageKey}/${params.parentMessageId}`,
      modelRuntimeConfig: {
        model,
        provider: provider!,
      },
    });

    const runtime = new AgentRuntime(agent, {
      executors: createAgentExecutors({
        get,
        messageKey,
        operationId,
        parentId: params.parentMessageId,
        skipCreateFirstMessage: params.skipCreateFirstMessage,
      }),
      getOperation: (opId: string) => {
        const op = get().operations[opId];
        if (!op) throw new Error(`Operation not found: ${opId}`);
        return {
          abortController: op.abortController,
          context: op.context,
        };
      },
      operationId,
    });

    // Create agent state and context with user intervention config
    const { state: initialAgentState, context: initialAgentContext } =
      get().internal_createAgentState({
        messages,
        parentMessageId: params.parentMessageId,
        agentId,
        topicId,
        threadId: threadId ?? undefined,
        initialState: params.initialState,
        initialContext: params.initialContext,
        operationId,
        subAgentId, // Pass subAgentId for agent config retrieval
      });

    let state = initialAgentState;
    let nextContext = initialAgentContext;

    log(
      '[internal_execAgentRuntime] Agent runtime loop start, initial phase: %s',
      nextContext.phase,
    );

    // Execute the agent runtime loop
    let stepCount = 0;
    while (state.status !== 'done' && state.status !== 'error') {
      // Check if operation has been cancelled
      const currentOperation = get().operations[operationId];
      if (currentOperation?.status === 'cancelled') {
        log('[internal_execAgentRuntime] Operation cancelled, marking state as interrupted');

        // Update state status to 'interrupted' so agent can handle abort
        state = { ...state, status: 'interrupted' };

        // Let agent handle the abort (will clean up pending tools if needed)
        const result = await runtime.step(state, nextContext);
        state = result.newState;

        log('[internal_execAgentRuntime] Operation cancelled, stopping loop');
        break;
      }

      stepCount++;

      // Compute step context from current db messages before each step
      // Use dbMessagesMap which contains persisted state (including pluginState.todos)
      const currentDBMessages = get().dbMessagesMap[messageKey] || [];
      // Use selectTodosFromMessages selector (shared with UI display)
      const todos = selectTodosFromMessages(currentDBMessages);
      const stepContext = computeStepContext({ todos });

      // If page agent is enabled, get the latest XML for stepPageEditor
      if (nextContext.initialContext?.pageEditor) {
        try {
          const pageContentContext = pageAgentRuntime.getPageContentContext('xml');
          stepContext.stepPageEditor = {
            xml: pageContentContext.xml || '',
          };
        } catch (error) {
          // Page agent runtime may not be available, ignore errors
          log('[internal_execAgentRuntime] Failed to get page XML for step: %o', error);
        }
      }

      // Inject stepContext into the runtime context for this step
      nextContext = { ...nextContext, stepContext };

      log(
        '[internal_execAgentRuntime][step-%d]: phase=%s, status=%s, stepContext=%O',
        stepCount,
        nextContext.phase,
        state.status,
        stepContext,
      );

      const result = await runtime.step(state, nextContext);

      log(
        '[internal_execAgentRuntime] Step %d completed, events: %d, newStatus=%s',
        stepCount,
        result.events.length,
        result.newState.status,
      );

      // Handle completion and error events
      for (const event of result.events) {
        switch (event.type) {
          case 'done': {
            log('[internal_execAgentRuntime] Received done event');
            break;
          }

          case 'error': {
            log('[internal_execAgentRuntime] Received error event: %o', event.error);
            // Find the assistant message to update error
            const currentMessages = get().messagesMap[messageKey] || [];
            const assistantMessage = currentMessages.findLast((m) => m.role === 'assistant');
            if (assistantMessage) {
              await messageService.updateMessageError(assistantMessage.id, event.error, {
                agentId,
                groupId,
                topicId,
              });
            }
            const finalMessages = get().messagesMap[messageKey] || [];
            get().replaceMessages(finalMessages, { context });
            break;
          }
        }
      }

      state = result.newState;

      // Check if operation was cancelled after step completion
      const operationAfterStep = get().operations[operationId];
      if (operationAfterStep?.status === 'cancelled') {
        log(
          '[internal_execAgentRuntime] Operation cancelled after step %d, marking state as interrupted',
          stepCount,
        );

        // Set state.status to 'interrupted' to trigger agent abort handling
        state = { ...state, status: 'interrupted' };

        // Let agent handle the abort (will clean up pending tools if needed)
        // Use result.nextContext if available (e.g., llm_result with tool calls)
        // otherwise fallback to current nextContext
        const contextForAbort = result.nextContext || nextContext;
        const abortResult = await runtime.step(state, contextForAbort);
        state = abortResult.newState;

        log('[internal_execAgentRuntime] Operation cancelled, stopping loop');
        break;
      }

      // If no nextContext, stop execution
      if (!result.nextContext) {
        log('[internal_execAgentRuntime] No next context, stopping loop');
        break;
      }

      // Preserve initialContext when updating nextContext
      // initialContext is set once at the start and should persist through all steps
      nextContext = { ...result.nextContext, initialContext: nextContext.initialContext };
    }

    log(
      '[internal_execAgentRuntime] Agent runtime loop finished, final status: %s, total steps: %d',
      state.status,
      stepCount,
    );

    // Execute afterCompletion hooks before completing operation
    // These are registered by tools (e.g., speak/broadcast/delegate) that need to
    // trigger actions after the AgentRuntime finishes
    const operation = get().operations[operationId];
    const afterCompletionCallbacks = operation?.metadata?.runtimeHooks?.afterCompletionCallbacks;
    if (afterCompletionCallbacks && afterCompletionCallbacks.length > 0) {
      log(
        '[internal_execAgentRuntime] Executing %d afterCompletion callbacks',
        afterCompletionCallbacks.length,
      );

      for (const callback of afterCompletionCallbacks) {
        try {
          await callback();
        } catch (error) {
          console.error('[internal_execAgentRuntime] afterCompletion callback error:', error);
        }
      }

      log('[internal_execAgentRuntime] afterCompletion callbacks executed');
    }

    // Complete operation based on final state
    switch (state.status) {
      case 'done': {
        get().completeOperation(operationId);
        log('[internal_execAgentRuntime] Operation completed successfully');
        break;
      }
      case 'error': {
        get().failOperation(operationId, {
          type: 'runtime_error',
          message: 'Agent runtime execution failed',
        });
        log('[internal_execAgentRuntime] Operation failed');
        break;
      }
      case 'waiting_for_human': {
        // When waiting for human intervention, complete the current operation
        // A new operation will be created when user approves/rejects
        get().completeOperation(operationId);
        log('[internal_execAgentRuntime] Operation paused for human intervention');
        break;
      }
    }

    log('[internal_execAgentRuntime] completed');

    // Desktop notification (if not in tools calling mode)
    if (isDesktop) {
      try {
        const finalMessages = get().messagesMap[messageKey] || [];
        const lastAssistant = finalMessages.findLast((m) => m.role === 'assistant');

        // Only show notification if there's content and no tools
        if (lastAssistant?.content && !lastAssistant?.tools) {
          const { desktopNotificationService } =
            await import('@/services/electron/desktopNotification');

          await desktopNotificationService.showNotification({
            body: lastAssistant.content,
            title: t('notification.finishChatGeneration', { ns: 'electron' }),
          });
        }
      } catch (error) {
        console.error('Desktop notification error:', error);
      }
    }

    // Summary history if context messages is larger than historyCount
    const historyCount = chatConfig.historyCount ?? 0;

    if (
      chatConfig.enableHistoryCount &&
      chatConfig.enableCompressHistory &&
      messages.length > historyCount
    ) {
      // after generation: [u1,a1,u2,a2,u3,a3]
      // but the `messages` is still: [u1,a1,u2,a2,u3]
      // So if historyCount=2, we need to summary [u1,a1,u2,a2]
      // because user find UI is [u1,a1,u2,a2 | u3,a3]
      const historyMessages = messages.slice(0, -historyCount + 1);

      await get().internal_summaryHistory(historyMessages);
    }
  },
});
