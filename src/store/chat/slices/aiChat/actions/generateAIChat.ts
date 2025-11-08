/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { LOADING_FLAT, MESSAGE_CANCEL_FLAT, isDesktop, isServerMode } from '@lobechat/const';
import { knowledgeBaseQAPrompts } from '@lobechat/prompts';
import {
  ChatImageItem,
  CreateMessageParams,
  MessageSemanticSearchChunk,
  SendMessageParams,
  TraceEventType,
  TraceNameMap,
  UIChatMessage,
} from '@lobechat/types';
import { t } from 'i18next';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra';
import { getAiInfraStoreState } from '@/store/aiInfra/store';
import { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getFileStoreState } from '@/store/file/store';
import { useSessionStore } from '@/store/session';
import { WebBrowsingManifest } from '@/tools/web-browsing';
import { Action, setNamespace } from '@/utils/storeDebug';

import { chatSelectors, topicSelectors } from '../../../selectors';

const n = setNamespace('ai');

interface ProcessMessageParams {
  traceId?: string;
  isWelcomeQuestion?: boolean;
  inSearchWorkflow?: boolean;
  /**
   * the RAG query content, should be embedding and used in the semantic search
   */
  ragQuery?: string;
  threadId?: string;
  inPortalThread?: boolean;

  groupId?: string;
  agentId?: string;
  agentConfig?: any; // Agent configuration for group chat agents
}

export interface AIGenerateAction {
  /**
   * Sends a new message to the AI chat system
   */
  sendMessage: (params: SendMessageParams) => Promise<void>;
  /**
   * Regenerates a specific message in the chat
   */
  regenerateMessage: (id: string) => Promise<void>;
  /**
   * Deletes an existing message and generates a new one in its place
   */
  delAndRegenerateMessage: (id: string) => Promise<void>;
  /**
   * Interrupts the ongoing ai message generation process
   */
  stopGenerateMessage: () => void;

  // =========  ↓ Internal Method ↓  ========== //
  // ========================================== //
  // ========================================== //

  /**
   * Executes the core processing logic for AI messages
   * including preprocessing and postprocessing steps
   */
  internal_coreProcessMessage: (
    messages: UIChatMessage[],
    parentId: string,
    params?: ProcessMessageParams,
  ) => Promise<void>;
  /**
   * Retrieves an AI-generated chat message from the backend service
   */
  internal_fetchAIChatMessage: (input: {
    messages: UIChatMessage[];
    messageId: string;
    params?: ProcessMessageParams;
    model: string;
    provider: string;
  }) => Promise<{
    isFunctionCall: boolean;
    content: string;
    traceId?: string;
  }>;
  /**
   * Resends a specific message, optionally using a trace ID for tracking
   */
  internal_resendMessage: (
    id: string,
    params?: {
      traceId?: string;
      messages?: UIChatMessage[];
      threadId?: string;
      inPortalThread?: boolean;
    },
  ) => Promise<void>;
  /**
   * Toggles the loading state for AI message generation, managing the UI feedback
   */
  internal_toggleChatLoading: (
    loading: boolean,
    id?: string,
    action?: Action,
  ) => AbortController | undefined;
  internal_toggleMessageInToolsCalling: (
    loading: boolean,
    id?: string,
    action?: Action,
  ) => AbortController | undefined;
  /**
   * Controls the streaming state of tool calling processes, updating the UI accordingly
   */
  internal_toggleToolCallingStreaming: (id: string, streaming: boolean[] | undefined) => void;
  /**
   * Toggles the loading state for AI message reasoning, managing the UI feedback
   */
  internal_toggleChatReasoning: (
    loading: boolean,
    id?: string,
    action?: string,
  ) => AbortController | undefined;

  internal_toggleSearchWorkflow: (loading: boolean, id?: string) => void;
}

export const generateAIChat: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  AIGenerateAction
> = (set, get) => ({
  delAndRegenerateMessage: async (id) => {
    const traceId = chatSelectors.getTraceIdByMessageId(id)(get());
    get().internal_resendMessage(id, { traceId });
    get().deleteMessage(id);

    // trace the delete and regenerate message
    get().internal_traceMessage(id, { eventType: TraceEventType.DeleteAndRegenerateMessage });
  },
  regenerateMessage: async (id) => {
    const traceId = chatSelectors.getTraceIdByMessageId(id)(get());
    await get().internal_resendMessage(id, { traceId });

    // trace the delete and regenerate message
    get().internal_traceMessage(id, { eventType: TraceEventType.RegenerateMessage });
  },

  sendMessage: async ({ message, files, onlyAddUserMessage, isWelcomeQuestion }) => {
    const {
      internal_coreProcessMessage,
      activeTopicId,
      activeId,
      activeThreadId,
      sendMessageInServer,
    } = get();
    if (!activeId) return;

    const fileIdList = files?.map((f) => f.id);

    const hasFile = !!fileIdList && fileIdList.length > 0;

    // if message is empty or no files, then stop
    if (!message && !hasFile) return;

    // router to server mode send message
    if (isServerMode)
      return sendMessageInServer({ message, files, onlyAddUserMessage, isWelcomeQuestion });

    set({ isCreatingMessage: true }, false, n('creatingMessage/start'));

    const newMessage: CreateMessageParams = {
      content: message,
      // if message has attached with files, then add files to message and the agent
      files: fileIdList,
      role: 'user',
      sessionId: activeId,
      // if there is activeTopicId，then add topicId to message
      topicId: activeTopicId,
      threadId: activeThreadId,
    };

    const agentConfig = agentChatConfigSelectors.currentChatConfig(getAgentStoreState());

    let tempMessageId: string | undefined = undefined;
    let newTopicId: string | undefined = undefined;

    // it should be the default topic, then
    // if autoCreateTopic is enabled, check to whether we need to create a topic
    if (!onlyAddUserMessage && !activeTopicId && agentConfig.enableAutoCreateTopic) {
      // check activeTopic and then auto create topic
      const chats = chatSelectors.activeBaseChats(get());

      // we will add two messages (user and assistant), so the finial length should +2
      const featureLength = chats.length + 2;

      // if there is no activeTopicId and the feature length is greater than the threshold
      // then create a new topic and active it
      if (!activeTopicId && featureLength >= agentConfig.autoCreateTopicThreshold) {
        // we need to create a temp message for optimistic update
        tempMessageId = get().internal_createTmpMessage(newMessage);
        get().internal_toggleMessageLoading(true, tempMessageId);

        const topicId = await get().createTopic();

        if (topicId) {
          newTopicId = topicId;
          newMessage.topicId = topicId;

          // we need to copy the messages to the new topic or the message will disappear
          const mapKey = chatSelectors.currentChatKey(get());
          const newMaps = {
            ...get().messagesMap,
            [messageMapKey(activeId, topicId)]: get().messagesMap[mapKey],
          };
          set({ messagesMap: newMaps }, false, n('moveMessagesToNewTopic'));

          // make the topic loading
          get().internal_updateTopicLoading(topicId, true);
        }
      }
    }
    //  update assistant update to make it rerank
    useSessionStore.getState().triggerSessionUpdate(get().activeId);

    const id = await get().internal_createMessage(newMessage, {
      tempMessageId,
      skipRefresh: !onlyAddUserMessage && newMessage.fileList?.length === 0,
    });

    if (!id) {
      set({ isCreatingMessage: false }, false, n('creatingMessage/start'));
      if (!!newTopicId) get().internal_updateTopicLoading(newTopicId, false);
      return;
    }

    if (tempMessageId) get().internal_toggleMessageLoading(false, tempMessageId);

    // switch to the new topic if create the new topic
    if (!!newTopicId) {
      await get().switchTopic(newTopicId, true);
      await get().internal_fetchMessages();

      // delete previous messages
      // remove the temp message map
      const newMaps = { ...get().messagesMap, [messageMapKey(activeId, null)]: [] };
      set({ messagesMap: newMaps }, false, 'internal_copyMessages');
    }

    // if only add user message, then stop
    if (onlyAddUserMessage) {
      set({ isCreatingMessage: false }, false, 'creatingMessage/start');
      return;
    }

    // Get the current messages to generate AI response
    const messages = chatSelectors.activeBaseChats(get());
    const userFiles = chatSelectors.currentUserFiles(get()).map((f) => f.id);

    await internal_coreProcessMessage(messages, id, {
      isWelcomeQuestion,
      ragQuery: get().internal_shouldUseRAG() ? message : undefined,
      threadId: activeThreadId,
    });

    set({ isCreatingMessage: false }, false, n('creatingMessage/stop'));

    const summaryTitle = async () => {
      // if autoCreateTopic is false, then stop
      if (!agentConfig.enableAutoCreateTopic) return;

      // check activeTopic and then auto update topic title
      if (newTopicId) {
        const chats = chatSelectors.getBaseChatsByKey(messageMapKey(activeId, newTopicId))(get());
        await get().summaryTopicTitle(newTopicId, chats);
        return;
      }

      if (!activeTopicId) return;
      const topic = topicSelectors.getTopicById(activeTopicId)(get());

      if (topic && !topic.title) {
        const chats = chatSelectors.getBaseChatsByKey(messageMapKey(activeId, topic.id))(get());
        await get().summaryTopicTitle(topic.id, chats);
      }
    };

    // if there is relative files, then add files to agent
    // only available in server mode
    const addFilesToAgent = async () => {
      if (userFiles.length === 0 || !isServerMode) return;

      await useAgentStore.getState().addFilesToAgent(userFiles, false);
    };

    await Promise.all([summaryTitle(), addFilesToAgent()]);
  },
  stopGenerateMessage: () => {
    const { chatLoadingIdsAbortController, internal_toggleChatLoading } = get();

    if (!chatLoadingIdsAbortController) return;

    chatLoadingIdsAbortController.abort(MESSAGE_CANCEL_FLAT);

    internal_toggleChatLoading(false, undefined, n('stopGenerateMessage') as string);
  },

  // the internal process method of the AI message
  internal_coreProcessMessage: async (originalMessages, userMessageId, params) => {
    const { internal_fetchAIChatMessage, triggerToolCalls, refreshMessages, activeTopicId } = get();

    // create a new array to avoid the original messages array change
    const messages = [...originalMessages];

    const agentStoreState = getAgentStoreState();
    const { model, provider, chatConfig } = agentSelectors.currentAgentConfig(agentStoreState);

    let fileChunks: MessageSemanticSearchChunk[] | undefined;
    let ragQueryId;

    // go into RAG flow if there is ragQuery flag
    if (params?.ragQuery) {
      // 1. get the relative chunks from semantic search
      const { chunks, queryId, rewriteQuery } = await get().internal_retrieveChunks(
        userMessageId,
        params?.ragQuery,
        // should skip the last content
        messages.map((m) => m.content).slice(0, messages.length - 1),
      );

      ragQueryId = queryId;

      const lastMsg = messages.pop() as UIChatMessage;

      // 2. build the retrieve context messages
      const knowledgeBaseQAContext = knowledgeBaseQAPrompts({
        chunks,
        userQuery: lastMsg.content,
        rewriteQuery,
        knowledge: agentSelectors.currentEnabledKnowledge(agentStoreState),
      });

      // 3. add the retrieve context messages to the messages history
      messages.push({
        ...lastMsg,
        content: (lastMsg.content + '\n\n' + knowledgeBaseQAContext).trim(),
      });

      fileChunks = chunks.map((c) => ({ id: c.id, similarity: c.similarity }));
    }

    // 2. Add an empty message to place the AI response
    const assistantMessage: CreateMessageParams = {
      role: 'assistant',
      content: LOADING_FLAT,
      fromModel: model,
      fromProvider: provider,

      parentId: userMessageId,
      sessionId: get().activeId,
      topicId: activeTopicId, // if there is activeTopicId，then add it to topicId
      threadId: params?.threadId,
      fileChunks,
      ragQueryId,
    };

    const assistantId = await get().internal_createMessage(assistantMessage);

    if (!assistantId) return;

    // 3. place a search with the search working model if this model is not support tool use
    const aiInfraStoreState = getAiInfraStoreState();
    const isModelSupportToolUse = aiModelSelectors.isModelSupportToolUse(
      model,
      provider!,
    )(aiInfraStoreState);
    const isProviderHasBuiltinSearch = aiProviderSelectors.isProviderHasBuiltinSearch(provider!)(
      aiInfraStoreState,
    );
    const isModelHasBuiltinSearch = aiModelSelectors.isModelHasBuiltinSearch(
      model,
      provider!,
    )(aiInfraStoreState);
    const isModelBuiltinSearchInternal = aiModelSelectors.isModelBuiltinSearchInternal(
      model,
      provider!,
    )(aiInfraStoreState);
    const useModelBuiltinSearch = agentChatConfigSelectors.useModelBuiltinSearch(agentStoreState);
    const useModelSearch =
      ((isProviderHasBuiltinSearch || isModelHasBuiltinSearch) && useModelBuiltinSearch) ||
      isModelBuiltinSearchInternal;
    const isAgentEnableSearch = agentChatConfigSelectors.isAgentEnableSearch(agentStoreState);

    if (isAgentEnableSearch && !useModelSearch && !isModelSupportToolUse) {
      const { model, provider } = agentChatConfigSelectors.searchFCModel(agentStoreState);

      let isToolsCalling = false;
      let isError = false;

      const abortController = get().internal_toggleChatLoading(
        true,
        assistantId,
        n('generateMessage(start)', { messageId: assistantId, messages }),
      );

      get().internal_toggleSearchWorkflow(true, assistantId);
      await chatService.fetchPresetTaskResult({
        params: { messages, model, provider, plugins: [WebBrowsingManifest.identifier] },
        onFinish: async (_, { toolCalls, usage }) => {
          if (toolCalls && toolCalls.length > 0) {
            get().internal_toggleToolCallingStreaming(assistantId, undefined);
            // update tools calling
            await get().internal_updateMessageContent(assistantId, '', {
              toolCalls,
              metadata: usage,
              model,
              provider,
            });
          }
        },
        trace: {
          traceId: params?.traceId,
          sessionId: get().activeId,
          topicId: get().activeTopicId,
          traceName: TraceNameMap.SearchIntentRecognition,
        },
        abortController,
        onMessageHandle: async (chunk) => {
          if (chunk.type === 'tool_calls') {
            get().internal_toggleSearchWorkflow(false, assistantId);
            get().internal_toggleToolCallingStreaming(assistantId, chunk.isAnimationActives);
            get().internal_dispatchMessage({
              id: assistantId,
              type: 'updateMessage',
              value: { tools: get().internal_transformToolCalls(chunk.tool_calls) },
            });
            isToolsCalling = true;
          }

          if (chunk.type === 'text') {
            abortController!.abort('not fc');
          }
        },
        onErrorHandle: async (error) => {
          isError = true;
          await messageService.updateMessageError(assistantId, error);
          await refreshMessages();
        },
      });

      get().internal_toggleChatLoading(
        false,
        assistantId,
        n('generateMessage(start)', { messageId: assistantId, messages }),
      );
      get().internal_toggleSearchWorkflow(false, assistantId);

      // if there is error, then stop
      if (isError) return;

      // if it's the function call message, trigger the function method
      if (isToolsCalling) {
        get().internal_toggleMessageInToolsCalling(true, assistantId);
        await refreshMessages();
        await triggerToolCalls(assistantId, {
          threadId: params?.threadId,
          inPortalThread: params?.inPortalThread,
        });

        // then story the workflow
        return;
      }
    }

    // 4. fetch the AI response
    const { isFunctionCall, content } = await internal_fetchAIChatMessage({
      messages,
      messageId: assistantId,
      params,
      model,
      provider: provider!,
    });

    // 5. if it's the function call message, trigger the function method
    if (isFunctionCall) {
      get().internal_toggleMessageInToolsCalling(true, assistantId);
      await refreshMessages();
      await triggerToolCalls(assistantId, {
        threadId: params?.threadId,
        inPortalThread: params?.inPortalThread,
      });
    } else {
      // 显示桌面通知（仅在桌面端且窗口隐藏时）
      if (isDesktop) {
        try {
          // 动态导入桌面通知服务，避免在非桌面端环境中导入
          const { desktopNotificationService } = await import(
            '@/services/electron/desktopNotification'
          );

          await desktopNotificationService.showNotification({
            body: content,
            title: t('notification.finishChatGeneration', { ns: 'electron' }),
          });
        } catch (error) {
          // 静默处理错误，不影响正常流程
          console.error('Desktop notification error:', error);
        }
      }
    }

    // 6. summary history if context messages is larger than historyCount
    const historyCount = agentChatConfigSelectors.historyCount(agentStoreState);

    if (
      agentChatConfigSelectors.enableHistoryCount(agentStoreState) &&
      chatConfig.enableCompressHistory &&
      originalMessages.length > historyCount
    ) {
      // after generation: [u1,a1,u2,a2,u3,a3]
      // but the `originalMessages` is still: [u1,a1,u2,a2,u3]
      // So if historyCount=2, we need to summary [u1,a1,u2,a2]
      // because user find UI is [u1,a1,u2,a2 | u3,a3]
      const historyMessages = originalMessages.slice(0, -historyCount + 1);

      await get().internal_summaryHistory(historyMessages);
    }
  },
  internal_fetchAIChatMessage: async ({ messages, messageId, params, provider, model }) => {
    const {
      internal_toggleChatLoading,
      refreshMessages,
      internal_updateMessageContent,
      internal_dispatchMessage,
      internal_toggleToolCallingStreaming,
      internal_toggleChatReasoning,
    } = get();

    const abortController = internal_toggleChatLoading(
      true,
      messageId,
      n('generateMessage(start)', { messageId, messages }),
    );

    const agentConfig =
      params?.agentConfig || agentSelectors.currentAgentConfig(getAgentStoreState());
    const chatConfig = agentChatConfigSelectors.currentChatConfig(getAgentStoreState());

    // ================================== //
    //   messages uniformly preprocess    //
    // ================================== //
    // 4. handle max_tokens
    agentConfig.params.max_tokens = chatConfig.enableMaxTokens
      ? agentConfig.params.max_tokens
      : undefined;

    // 5. handle reasoning_effort
    agentConfig.params.reasoning_effort = chatConfig.enableReasoningEffort
      ? agentConfig.params.reasoning_effort
      : undefined;

    let isFunctionCall = false;
    let msgTraceId: string | undefined;
    let output = '';
    let thinking = '';
    let thinkingStartAt: number;
    let duration: number;
    // to upload image
    const uploadTasks: Map<string, Promise<{ id?: string; url?: string }>> = new Map();

    const historySummary = chatConfig.enableCompressHistory
      ? topicSelectors.currentActiveTopicSummary(get())
      : undefined;
    await chatService.createAssistantMessageStream({
      abortController,
      params: {
        messages,
        model,
        provider,
        ...agentConfig.params,
        plugins: agentConfig.plugins,
      },
      historySummary: historySummary?.content,
      trace: {
        traceId: params?.traceId,
        sessionId: get().activeId,
        topicId: get().activeTopicId,
        traceName: TraceNameMap.Conversation,
      },
      isWelcomeQuestion: params?.isWelcomeQuestion,
      onErrorHandle: async (error) => {
        await messageService.updateMessageError(messageId, error);
        await refreshMessages();
      },
      onFinish: async (
        content,
        { traceId, observationId, toolCalls, reasoning, grounding, usage, speed },
      ) => {
        // if there is traceId, update it
        if (traceId) {
          msgTraceId = traceId;
          await messageService.updateMessage(messageId, {
            traceId,
            observationId: observationId ?? undefined,
          });
        }

        // 等待所有图片上传完成
        let finalImages: ChatImageItem[] = [];

        if (uploadTasks.size > 0) {
          try {
            // 等待所有上传任务完成
            const uploadResults = await Promise.all(uploadTasks.values());

            // 使用上传后的 S3 URL 替换原始图像数据
            finalImages = uploadResults.filter((i) => !!i.url) as ChatImageItem[];
          } catch (error) {
            console.error('Error waiting for image uploads:', error);
          }
        }

        let parsedToolCalls = toolCalls;
        if (parsedToolCalls && parsedToolCalls.length > 0) {
          internal_toggleToolCallingStreaming(messageId, undefined);
          parsedToolCalls = parsedToolCalls.map((item) => ({
            ...item,
            function: {
              ...item.function,
              arguments: !!item.function.arguments ? item.function.arguments : '{}',
            },
          }));
          isFunctionCall = true;
        }

        // update the content after fetch result
        await internal_updateMessageContent(messageId, content, {
          toolCalls: parsedToolCalls,
          reasoning: !!reasoning ? { ...reasoning, duration } : undefined,
          search: !!grounding?.citations ? grounding : undefined,
          imageList: finalImages.length > 0 ? finalImages : undefined,
          metadata: speed ? { ...usage, ...speed } : usage,
        });
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

            internal_dispatchMessage({
              id: messageId,
              type: 'updateMessage',
              value: {
                search: {
                  citations: chunk.grounding.citations,
                  searchQueries: chunk.grounding.searchQueries,
                },
              },
            });
            break;
          }

          case 'base64_image': {
            internal_dispatchMessage({
              id: messageId,
              type: 'updateMessage',
              value: {
                imageList: chunk.images.map((i) => ({ id: i.id, url: i.data, alt: i.id })),
              },
            });
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

            // if there is no duration, it means the end of reasoning
            if (!duration) {
              duration = Date.now() - thinkingStartAt;

              const isInChatReasoning = chatSelectors.isMessageInChatReasoning(messageId)(get());
              if (isInChatReasoning) {
                internal_toggleChatReasoning(
                  false,
                  messageId,
                  n('toggleChatReasoning/false') as string,
                );
              }
            }

            internal_dispatchMessage({
              id: messageId,
              type: 'updateMessage',
              value: {
                content: output,
                reasoning: !!thinking ? { content: thinking, duration } : undefined,
              },
            });
            break;
          }

          case 'reasoning': {
            // if there is no thinkingStartAt, it means the start of reasoning
            if (!thinkingStartAt) {
              thinkingStartAt = Date.now();
              internal_toggleChatReasoning(
                true,
                messageId,
                n('toggleChatReasoning/true') as string,
              );
            }

            thinking += chunk.text;

            internal_dispatchMessage({
              id: messageId,
              type: 'updateMessage',
              value: { reasoning: { content: thinking } },
            });
            break;
          }

          // is this message is just a tool call
          case 'tool_calls': {
            internal_toggleToolCallingStreaming(messageId, chunk.isAnimationActives);
            internal_dispatchMessage({
              id: messageId,
              type: 'updateMessage',
              value: { tools: get().internal_transformToolCalls(chunk.tool_calls) },
            });
            isFunctionCall = true;
          }
        }
      },
    });

    internal_toggleChatLoading(false, messageId, n('generateMessage(end)') as string);

    return { isFunctionCall, traceId: msgTraceId, content: output };
  },

  internal_resendMessage: async (
    messageId,
    { traceId, messages: outChats, threadId: outThreadId, inPortalThread } = {},
  ) => {
    // 1. 构造所有相关的历史记录
    const chats = outChats ?? chatSelectors.mainAIChats(get());

    const currentIndex = chats.findIndex((c) => c.id === messageId);
    if (currentIndex < 0) return;

    const currentMessage = chats[currentIndex];

    let contextMessages: UIChatMessage[] = [];

    switch (currentMessage.role) {
      case 'tool':
      case 'user': {
        contextMessages = chats.slice(0, currentIndex + 1);
        break;
      }
      case 'assistant': {
        // 消息是 AI 发出的因此需要找到它的 user 消息
        const userId = currentMessage.parentId;
        const userIndex = chats.findIndex((c) => c.id === userId);
        // 如果消息没有 parentId，那么同 user/function 模式
        contextMessages = chats.slice(0, userIndex < 0 ? currentIndex + 1 : userIndex + 1);
        break;
      }
    }

    if (contextMessages.length <= 0) return;

    const { internal_coreProcessMessage, activeThreadId } = get();

    const latestMsg = contextMessages.findLast((s) => s.role === 'user');

    if (!latestMsg) return;

    const threadId = outThreadId ?? activeThreadId;

    await internal_coreProcessMessage(contextMessages, latestMsg.id, {
      traceId,
      ragQuery: get().internal_shouldUseRAG() ? latestMsg.content : undefined,
      threadId,
      inPortalThread,
    });
  },

  // ----- Loading ------- //
  internal_toggleChatLoading: (loading, id, action) => {
    return get().internal_toggleLoadingArrays('chatLoadingIds', loading, id, action);
  },
  internal_toggleMessageInToolsCalling: (loading, id) => {
    return get().internal_toggleLoadingArrays('messageInToolsCallingIds', loading, id);
  },
  internal_toggleChatReasoning: (loading, id, action) => {
    return get().internal_toggleLoadingArrays('reasoningLoadingIds', loading, id, action);
  },
  internal_toggleToolCallingStreaming: (id, streaming) => {
    set(
      {
        toolCallingStreamIds: produce(get().toolCallingStreamIds, (draft) => {
          if (!!streaming) {
            draft[id] = streaming;
          } else {
            delete draft[id];
          }
        }),
      },

      false,
      `toggleToolCallingStreaming/${!!streaming ? 'start' : 'end'}`,
    );
  },

  internal_toggleSearchWorkflow: (loading, id) => {
    return get().internal_toggleLoadingArrays('searchWorkflowLoadingIds', loading, id);
  },
});
