/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import {
  GroupMemberInfo,
  buildGroupChatSystemPrompt,
  filterMessagesForAgent,
} from '@lobechat/prompts';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import { LOADING_FLAT } from '@/const/message';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { userProfileSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';
import { ChatErrorType } from '@/types/fetch';
import { ChatMessage, CreateMessageParams, SendGroupMessageParams } from '@/types/message';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import type { ChatStoreState } from '../../../initialState';
import { toggleBooleanList } from '../../../utils';
import {
  GroupChatSupervisor,
  SupervisorContext,
  SupervisorDecisionList,
  SupervisorTodoItem,
} from '../../message/supervisor';

const n = setNamespace('aiGroupChat');

const supervisor = new GroupChatSupervisor();

/**
 * Delay between sequential agent responses in milliseconds
 */
const SEQUENTIAL_RESPONSE_DELAY = 1500;

const getDebounceThreshold = (responseSpeed?: 'slow' | 'medium' | 'fast'): number => {
  switch (responseSpeed) {
    case 'fast': {
      return 1500;
    }
    case 'medium': {
      return 5000;
    }
    case 'slow': {
      return 8000;
    }
    default: {
      return 5000;
    }
  }
};

const formatSupervisorTodoContent = (todos: SupervisorTodoItem[]): string => {
  // Pass todo data as JSON string for dedicated UI processing
  return JSON.stringify({
    type: 'supervisor_todo',
    todos: todos || [],
    timestamp: Date.now(),
  });
};

/**
 * Extract mentioned agent IDs from message content
 * Looks for <mention id="agentId">Name</mention> tags
 */
const extractMentionsFromContent = (
  content: string,
  groupMembers?: GroupMemberInfo[],
): string[] => {
  const mentionRegex = /<mention\s+[^>]*id="([^"]+)"[^>]*\/>/g;
  const mentions = new Set<string>();
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    const mentionId = match[1];
    if (!mentionId) continue;

    if (mentionId === 'ALL_MEMBERS') {
      if (groupMembers?.length) {
        groupMembers.forEach((member) => {
          if (member.id) mentions.add(member.id);
        });
      }
      continue;
    }

    mentions.add(mentionId);
  }

  return [...mentions];
};

/**
 * Check if a message is a tool calling message that requires a follow-up
 */
const isToolCallMessage = (message: ChatMessage): boolean => {
  return message.role === 'assistant' && !!message.tools && message.tools.length > 0;
};

/**
 * Count consecutive assistant messages from the end of the message list
 * This helps enforce maxResponseInRow limit
 */
const countConsecutiveAssistantMessages = (messages: ChatMessage[]): number => {
  let count = 0;

  // Count from the end of the array backwards
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Stop counting if we hit a user message
    if (message.role === 'user') {
      break;
    }

    // Count assistant messages (including those from agents)
    if (message.role === 'assistant') {
      count++;
    }

    // Skip system and tool messages, continue counting
  }

  return count;
};

/**
 * Check if we should avoid supervisor decisions based on recent messages
 * Returns true if the conversation flow should continue without supervisor intervention
 */
const shouldAvoidSupervisorDecision = (
  messages: ChatMessage[],
  maxResponseInRow?: number,
  isManualTrigger: boolean = false,
): boolean => {
  if (messages.length === 0) return true;

  const lastMessage = messages.at(-1);
  if (!lastMessage) return true;

  // Don't make decisions if the last message is a tool calling message
  // (it needs a follow-up assistant message)
  if (isToolCallMessage(lastMessage)) {
    return true;
  }

  // Don't make decisions if the last message is a tool response
  // (the conversation might still be in a tool calling sequence)
  if (lastMessage.role === 'tool') {
    return true;
  }

  // Only check maxResponseInRow limit for automatic triggers, not manual ones
  if (!isManualTrigger && maxResponseInRow && maxResponseInRow > 0) {
    const consecutiveCount = countConsecutiveAssistantMessages(messages);
    if (consecutiveCount >= maxResponseInRow) {
      console.log(
        `Avoiding automatic supervisor decision: ${consecutiveCount} consecutive assistant messages exceed limit of ${maxResponseInRow}`,
      );
      return true;
    }
  }

  return false;
};

export interface ChatGroupChatAction {
  /**
   * Sends a new message to a group chat and triggers agent responses
   */
  sendGroupMessage: (params: SendGroupMessageParams) => Promise<void>;

  // =========  ↓ Internal Group Chat Methods ↓  ========== //

  /**
   * Triggers supervisor decision for group chat
   */
  internal_triggerSupervisorDecision: (
    groupId: string,
    topicId?: string | null,
    isManualTrigger?: boolean,
  ) => Promise<void>;

  /**
   * Triggers supervisor decision with debounce logic (dynamic threshold based on group responseSpeed setting)
   * Fast: 1s, Medium: 2s, Slow: 5s, Default: 3s
   * Cancels previous pending decisions and schedules a new one
   */
  internal_triggerSupervisorDecisionDebounced: (groupId: string) => void;

  /**
   * Cancels pending supervisor decision for a group
   */
  internal_cancelSupervisorDecision: (groupId: string) => void;

  /**
   * Cancels all pending supervisor decisions (cleanup method)
   */
  internal_cancelAllSupervisorDecisions: () => void;

  /**
   * Update supervisor todo list for a group/topic combination
   */
  internal_updateSupervisorTodos: (
    groupId: string,
    topicId: string | null | undefined,
    todos: SupervisorTodoItem[],
  ) => void;

  /**
   * Executes agent responses for group chat based on supervisor decisions
   */
  internal_executeAgentResponses: (
    groupId: string,
    decisions: SupervisorDecisionList,
  ) => Promise<void>;

  /**
   * Processes a single agent message in group chat
   */
  internal_processAgentMessage: (
    groupId: string,
    agentId: string,
    targetId?: string,
    instruction?: string,
  ) => Promise<void>;

  /**
   * Sets the active group
   */
  internal_setActiveGroup: (groupId: string) => void;

  /**
   * Toggles supervisor loading state for group chat
   */
  internal_toggleSupervisorLoading: (loading: boolean, groupId?: string) => void;

  /**
   * Creates a supervisor error message for group chat
   */
  internal_createSupervisorErrorMessage: (
    groupId: string,
    error: Error | string,
    context?: string,
  ) => Promise<void>;
}

export const chatAiGroupChat: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupChatAction
> = (set, get) => {
  const selectGroupConfig = (groupId: string) => {
    const { groupMaps } = get();
    const group = groupMaps[groupId];

    return merge(DEFAULT_CHAT_GROUP_CHAT_CONFIG, group?.config || {});
  };

  return {
    sendGroupMessage: async ({ groupId, message, files, onlyAddUserMessage, targetMemberId }) => {
      const {
        internal_createMessage,
        internal_triggerSupervisorDecisionDebounced,
        internal_setActiveGroup,
        activeTopicId,
      } = get();

      if (!message.trim() && (!files || files.length === 0)) return;

      internal_setActiveGroup(groupId);

      set({ isCreatingMessage: true }, false, n('creatingGroupMessage/start'));

      try {
        const userMessage: CreateMessageParams = {
          content: message,
          files: files?.map((f) => f.id),
          role: 'user',
          groupId,
          sessionId: useSessionStore.getState().activeId,
          topicId: activeTopicId,
          targetId: targetMemberId,
        };

        const messageId = await internal_createMessage(userMessage);

        // if only add user message, then stop
        if (onlyAddUserMessage) {
          set({ isCreatingMessage: false }, false, n('creatingGroupMessage/onlyUser'));
          return;
        }

        if (messageId) {
          // Use the specific group's config rather than relying on active session
          const groupConfig = selectGroupConfig(groupId);

          // If supervisor is disabled, check for direct mentions and trigger them directly
          if (!groupConfig?.enableSupervisor) {
            const agents = sessionSelectors.currentGroupAgents(useSessionStore.getState());
            const mentionableGroupAgents: GroupMemberInfo[] = agents.map((agent) => ({
              id: agent.id,
              title: agent.title ?? agent.id,
            }));
            const mentionedAgentIds = extractMentionsFromContent(message, mentionableGroupAgents);

            const candidateAgentIds = new Set(mentionedAgentIds);

            if (targetMemberId && agents?.some((agent) => agent.id === targetMemberId)) {
              candidateAgentIds.add(targetMemberId);
            }

            if (candidateAgentIds.size > 0) {
              // Validate that mentioned agents exist in the group
              const validMentionedAgents = [...candidateAgentIds].filter((agentId) =>
                agents?.some((agent) => agent.id === agentId),
              );

              if (validMentionedAgents.length > 0) {
                console.log(
                  'Supervisor disabled, triggering direct mentions:',
                  validMentionedAgents,
                );

                // Process mentioned agents directly without supervisor decision
                const { internal_executeAgentResponses } = get();
                const decisions = validMentionedAgents.map((agentId) => ({
                  id: agentId,
                  target: targetMemberId && agentId === targetMemberId ? 'user' : undefined,
                }));

                await internal_executeAgentResponses(groupId, decisions);
              } else {
                console.log('Supervisor disabled, mentioned agents not found in group');
              }
            } else {
              if (targetMemberId) {
                console.log(
                  'Supervisor disabled and DM target not found in group, no agent responses triggered',
                );
              } else {
                console.log(
                  'Supervisor disabled and no mentions found, no agent responses triggered',
                );
              }
            }
          } else {
            internal_triggerSupervisorDecisionDebounced(groupId);
          }
        }
      } catch (error) {
        console.error('Failed to send group message:', error);
      } finally {
        set({ isCreatingMessage: false }, false, n('creatingGroupMessage/end'));
      }
    },

    // ========= ↓ Group Chat Internal Methods ↓ ========== //

    internal_triggerSupervisorDecision: async (
      groupId: string,
      topicId?: string | null,
      isManualTrigger: boolean = false,
    ) => {
      const {
        messagesMap,
        internal_toggleSupervisorLoading,
        internal_createMessage,
        supervisorTodos,
      } = get();

      // Capture topicId at invocation time to avoid leaking state after topic switches
      const currentTopicId = typeof topicId === 'undefined' ? get().activeTopicId : topicId;

      // Always read config for the provided groupId early so it can be used in createSupervisorTodoMessage
      const groupConfig = selectGroupConfig(groupId);

      const createSupervisorTodoMessage = async (todoList: SupervisorTodoItem[]) => {
        if (!groupId) return;

        const sessionId = useSessionStore.getState().activeId || groupId;
        if (!sessionId) return;

        const content = formatSupervisorTodoContent(todoList);
        const supervisorMessage: CreateMessageParams = {
          content,
          fromModel: groupConfig.orchestratorModel,
          fromProvider: groupConfig.orchestratorProvider,
          groupId,
          role: 'supervisor',
          sessionId,
          topicId: currentTopicId ?? undefined,
        };

        console.log('Creating supervisor todo message:', supervisorMessage);

        await internal_createMessage(supervisorMessage);
      };

      const messages = messagesMap[messageMapKey(groupId, currentTopicId)] || [];
      const agents = sessionSelectors.currentGroupAgents(useSessionStore.getState());

      if (messages.length === 0) return;

      // If supervisor is disabled, skip supervisor decision
      if (!groupConfig?.enableSupervisor) {
        console.log('Supervisor is disabled for this group, skipping supervisor decision');
        return;
      }

      // Skip supervisor decision if we're in the middle of tool calling sequence or exceeded maxResponseInRow (for automatic triggers only)
      if (shouldAvoidSupervisorDecision(messages, groupConfig?.maxResponseInRow, isManualTrigger)) {
        const reason = isManualTrigger
          ? 'waiting for tool calling sequence to complete'
          : 'waiting for tool calling sequence to complete or max responses exceeded';
        console.log(`Skipping supervisor decision - ${reason}`);
        return;
      }

      // Create AbortController for this supervisor decision
      const abortController = new AbortController();

      // Store the AbortController in state
      set(
        produce((state: ChatStoreState) => {
          state.supervisorDecisionAbortControllers[groupId] = abortController;
        }),
        false,
        n(`setSupervisorAbortController/${groupId}`),
      );

      // Get real user name from user store
      const userStoreState = getUserStoreState();
      const realUserName = userProfileSelectors.nickName(userStoreState) || 'User';

      try {
        const todoKey = messageMapKey(groupId, currentTopicId);

        const context: SupervisorContext = {
          allowDM: groupConfig.allowDM,
          availableAgents: agents!,
          groupId,
          messages,
          model: groupConfig.orchestratorModel,
          provider: groupConfig.orchestratorProvider,
          scene: groupConfig.scene,
          userName: realUserName,
          systemPrompt: groupConfig.systemPrompt,
          abortController,
          todoList: supervisorTodos?.[todoKey] || [],
        };

        internal_toggleSupervisorLoading(true, groupId);

        const { decisions, todos, todoUpdated } = await supervisor.makeDecision(context);

        // Turn off supervisor thinking immediately after decision is made
        internal_toggleSupervisorLoading(false, groupId);

        get().internal_updateSupervisorTodos(groupId, currentTopicId, todos);

        if (todoUpdated) {
          await createSupervisorTodoMessage(todos);
        }

        console.log('Supervisor decisions:', decisions);

        if (decisions.length > 0) {
          await get().internal_executeAgentResponses(groupId, decisions);
        }
      } catch (error) {
        // Turn off supervisor thinking on error
        internal_toggleSupervisorLoading(false, groupId);

        if (
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof Error && error.message.includes('The operation was aborted'))
        ) {
          console.log('Supervisor decision was aborted for group:', groupId);
          // Don't create error message for intentional aborts
        } else {
          console.error('Supervisor decision failed:', error);
          // Create supervisor error message to show the error to users
          await get().internal_createSupervisorErrorMessage(
            groupId,
            'Supervisor Decision Failed, Please check your configuration',
          );
        }
      } finally {
        // Clean up AbortController from state
        set(
          produce((state: ChatStoreState) => {
            delete state.supervisorDecisionAbortControllers[groupId];
          }),
          false,
          n(`cleanupSupervisorAbortController/${groupId}`),
        );
      }
    },

    internal_executeAgentResponses: async (groupId: string, decisions: SupervisorDecisionList) => {
      console.log('DEBUG: Executing agent responses with decisions:', decisions);
      const { internal_processAgentMessage, internal_triggerSupervisorDecisionDebounced } = get();

      // Read the target group's config to respect per-group settings
      const groupConfig = selectGroupConfig(groupId);
      const agents = sessionSelectors.currentGroupAgents(useSessionStore.getState());

      // Sort decisions by member order if response order is sequential
      const sortedDecisions =
        groupConfig?.responseOrder === 'sequential'
          ? [...decisions].sort((a, b) => {
              const agentA = agents?.find((agent) => agent.id === a.id);
              const agentB = agents?.find((agent) => agent.id === b.id);

              // Default to order 0 if not found or not set
              const orderA = agentA?.order ?? 0;
              const orderB = agentB?.order ?? 0;

              return orderA - orderB;
            })
          : decisions;

      try {
        if (groupConfig?.responseOrder === 'sequential') {
          // Process agents sequentially with delay
          for (const [index, decision] of sortedDecisions.entries()) {
            // Add delay between agents (except for the first one)
            if (index > 0) {
              await new Promise((resolve) => {
                setTimeout(resolve, SEQUENTIAL_RESPONSE_DELAY);
              });
            }

            await internal_processAgentMessage(
              groupId,
              decision.id,
              decision.target,
              decision.instruction,
            );
          }
        } else {
          // Process agents in parallel for natural response order
          const responsePromises = sortedDecisions.map((decision) =>
            internal_processAgentMessage(
              groupId,
              decision.id,
              decision.target,
              decision.instruction,
            ),
          );
          await Promise.all(responsePromises);
        }

        // Only trigger next supervisor decision after ALL agents have completed their responses
        // This prevents rapid-fire agent responses and gives time for conversation to settle
        if (sortedDecisions.length > 0) {
          internal_triggerSupervisorDecisionDebounced(groupId);
        }
      } catch (error) {
        console.error('Failed to execute agent responses:', error);
        // Create supervisor error message to show the error to users
        await get().internal_createSupervisorErrorMessage(
          groupId,
          error instanceof Error ? error : new Error(String(error)),
          'Agent Response Execution Failed',
        );
      }
    },

    // For group member responsing
    internal_processAgentMessage: async (
      groupId: string,
      agentId: string,
      targetId?: string,
      instruction?: string,
    ) => {
      console.log('DEBUG: internal_processAgentMessage called with:', {
        groupId,
        agentId,
        targetId,
        instruction,
      });
      const {
        messagesMap,
        internal_createMessage,
        internal_fetchAIChatMessage,
        refreshMessages,
        activeTopicId,
        internal_dispatchMessage,
        internal_toggleChatLoading,
        triggerToolCalls,
      } = get();

      try {
        const allMessages = messagesMap[messageMapKey(groupId, activeTopicId)] || [];
        if (allMessages.length === 0) return;

        // Filter messages for this specific agent based on DM targeting rules
        const messages = filterMessagesForAgent(allMessages, agentId);

        // Get group agents and find the specific agent
        const agents = sessionSelectors.currentGroupAgents(useSessionStore.getState());
        const agentData = agents?.find((agent) => agent.id === agentId);

        if (!agentData) {
          console.error(`Agent ${agentId} not found in group members`);
          return;
        }

        const agentProvider = agentData.provider || undefined;
        const agentModel = agentData.model || undefined;

        console.log('DEBUG: Group chat agent data:', agentData);

        if (!agentProvider || !agentModel) {
          console.error(`No provider or model configured for agent ${agentId}`);
          return;
        }

        // Get the individual agent's full configuration including temperature, top_p, etc.
        // const agentStoreState = getAgentStoreState();
        // const agentConfig = agentSelectors.getAgentConfigById(agentId)(agentStoreState);

        // Get real user name from user store
        const userStoreState = getUserStoreState();
        const realUserName = userProfileSelectors.nickName(userStoreState) || 'User';

        const agentTitleMap: GroupMemberInfo[] = [
          { id: 'user', title: realUserName },
          ...(agents || []).map((agent) => ({ id: agent.id || '', title: agent.title || '' })),
        ];

        const baseSystemRole = agentData.systemRole || '';
        const members: GroupMemberInfo[] = agentTitleMap as GroupMemberInfo[];
        const groupChatSystemPrompt = buildGroupChatSystemPrompt({
          groupMembers: members,
          baseSystemRole,
          agentId,
          messages,
          targetId,
          instruction,
        });

        // Create agent message using real agent config
        const agentMessage: CreateMessageParams = {
          role: 'assistant',
          fromModel: agentModel,
          groupId,
          content: LOADING_FLAT,
          fromProvider: agentProvider,
          agentId,
          sessionId: useSessionStore.getState().activeId,
          topicId: activeTopicId,
          targetId: targetId, // Use targetId when provided for DM messages
        };

        console.log('DEBUG: Creating agent message with:', agentMessage);

        const assistantId = await internal_createMessage(agentMessage);

        const systemMessage: ChatMessage = {
          id: 'group-system',
          role: 'system',
          content: groupChatSystemPrompt,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        };

        // Add author names to messages for better context
        const messagesWithAuthors = messages.map((msg) => {
          const authorInfo = agentTitleMap.find((member) =>
            msg.role === 'user' ? member.id === 'user' : member.id === msg.agentId,
          );
          const authorName = authorInfo?.title || (msg.role === 'user' ? realUserName : 'Unknown');
          const authorId = msg.role === 'user' ? 'user' : msg.agentId || 'unknown';

          // Keep user message as-is
          if (msg.role === 'user') {
            return {
              ...msg,
              content: msg.content,
            };
          }

          return {
            ...msg,
            content: `<author_name_do_not_include_in_your_response name="${authorName}" id="${authorId}" />${msg.content}`,
          };
        });

        // TODO: Use context engineering
        const messagesForAPI = [systemMessage, ...messagesWithAuthors];

        if (assistantId) {
          const { isFunctionCall } = await internal_fetchAIChatMessage({
            messages: messagesForAPI,
            messageId: assistantId,
            model: agentModel,
            provider: agentProvider,
            params: {
              traceId: `group-${groupId}-agent-${agentId}`,
              agentConfig: agentData,
            },
          });

          // Handle tool calling in group chat like single chat
          if (isFunctionCall) {
            get().internal_toggleMessageInToolsCalling(true, assistantId);
            await refreshMessages();
            await triggerToolCalls(assistantId, {
              threadId: undefined,
              inPortalThread: false,
            });
            // Change: if an agent message is a tool call, make the same agent speak again
            // instead of asking supervisor for a decision.
            await get().internal_processAgentMessage(groupId, agentId, targetId, instruction);
            return;
          }
        }

        await refreshMessages();

        // Don't trigger supervisor decision after individual agent responses
        // This prevents infinite loops of agent responses
        // Supervisor decisions should only be triggered after user messages or when all agents complete
      } catch (error) {
        console.error(`Failed to process message for agent ${agentId}:`, error);

        // Create supervisor error message to show the error to users
        await get().internal_createSupervisorErrorMessage(
          groupId,
          error instanceof Error ? error : new Error(String(error)),
          `Agent ${agentId} Response Failed`,
        );

        // Also update error state if we have an assistant message (for consistency with single chat)
        const currentMessages = get().messagesMap[messageMapKey(groupId, activeTopicId)] || [];
        const errorMessage = currentMessages.find(
          (m) => m.role === 'assistant' && m.agentId === agentId && m.content === LOADING_FLAT,
        );

        if (errorMessage) {
          internal_dispatchMessage({
            id: errorMessage.id,
            type: 'updateMessage',
            value: {
              content: `Error: Failed to generate response. ${error instanceof Error ? error.message : 'Unknown error'}`,
              error: {
                type: ChatErrorType.CreateMessageError,
                message: error instanceof Error ? error.message : 'Unknown error',
              },
            },
          });
        }
      } finally {
        internal_toggleChatLoading(false, undefined, n('processAgentMessage(end)'));
      }
    },

    internal_setActiveGroup: () => {
      // Update the active session type to 'group' when setting an active group
      get().internal_updateActiveSessionType('group');
    },

    internal_toggleSupervisorLoading: (loading: boolean, groupId?: string) => {
      set(
        {
          supervisorDecisionLoading: groupId
            ? toggleBooleanList(get().supervisorDecisionLoading, groupId, loading)
            : loading
              ? get().supervisorDecisionLoading
              : [],
        },
        false,
        n(`toggleSupervisorLoading/${loading ? 'start' : 'end'}`),
      );
    },

    internal_triggerSupervisorDecisionDebounced: (groupId: string) => {
      const { internal_cancelSupervisorDecision, internal_triggerSupervisorDecision } = get();

      internal_cancelSupervisorDecision(groupId);

      // Use per-group config for debounce calculation
      const groupConfig = selectGroupConfig(groupId);
      const responseSpeed = groupConfig?.responseSpeed;
      const debounceThreshold = getDebounceThreshold(responseSpeed);

      console.log(
        `Using debounce threshold: ${debounceThreshold}ms for responseSpeed: ${responseSpeed}`,
      );

      // Capture topicId at schedule time to decouple from future topic switches
      const scheduledTopicId = get().activeTopicId;

      // Set a new timer with dynamic debounce based on group settings
      const timerId = setTimeout(async () => {
        console.log(`Debounced supervisor decision triggered for group ${groupId}`);

        // Clean up the timer from state before executing
        set(
          produce((state: ChatStoreState) => {
            delete state.supervisorDebounceTimers[groupId];
          }),
          false,
          n(`cleanupSupervisorTimer/${groupId}`),
        );

        try {
          await internal_triggerSupervisorDecision(groupId, scheduledTopicId, false); // false = automatic trigger
        } catch (error) {
          console.error(`Failed to execute supervisor decision for group ${groupId}:`, error);
        }
      }, debounceThreshold);

      // Store the timer in state
      set(
        produce((state: ChatStoreState) => {
          state.supervisorDebounceTimers[groupId] = timerId as any;
        }),
        false,
        n(`setSupervisorTimer/${groupId}`),
      );
    },

    internal_cancelSupervisorDecision: (groupId: string) => {
      const {
        supervisorDebounceTimers,
        supervisorDecisionAbortControllers,
        internal_toggleSupervisorLoading,
      } = get();
      const existingTimer = supervisorDebounceTimers[groupId];
      const existingAbortController = supervisorDecisionAbortControllers[groupId];

      // Cancel pending debounced timer
      if (existingTimer) {
        clearTimeout(existingTimer);
        console.log(`Cancelled pending supervisor decision timer for group ${groupId}`);

        // Remove timer from state
        set(
          produce((state: ChatStoreState) => {
            delete state.supervisorDebounceTimers[groupId];
          }),
          false,
          n(`cancelSupervisorTimer/${groupId}`),
        );
      }

      // Abort ongoing supervisor decision request
      if (existingAbortController) {
        existingAbortController.abort('User cancelled supervisor decision');
        console.log(`Aborted ongoing supervisor decision request for group ${groupId}`);

        // Remove abort controller from state
        set(
          produce((state: ChatStoreState) => {
            delete state.supervisorDecisionAbortControllers[groupId];
          }),
          false,
          n(`cancelSupervisorAbortController/${groupId}`),
        );
      }

      // Stop the loading state
      internal_toggleSupervisorLoading(false, groupId);
      console.log(`Stopped supervisor loading state for group ${groupId}`);
    },

    internal_cancelAllSupervisorDecisions: () => {
      const { supervisorDebounceTimers, supervisorDecisionAbortControllers } = get();
      const timerGroupIds = Object.keys(supervisorDebounceTimers);
      const abortControllerGroupIds = Object.keys(supervisorDecisionAbortControllers);

      if (timerGroupIds.length > 0 || abortControllerGroupIds.length > 0) {
        console.log('Cancelling all pending supervisor decisions for session change/cleanup');

        // Cancel all timers
        timerGroupIds.forEach((groupId) => {
          const timer = supervisorDebounceTimers[groupId];
          if (timer) {
            clearTimeout(timer);
          }
        });

        // Abort all ongoing requests
        abortControllerGroupIds.forEach((groupId) => {
          const abortController = supervisorDecisionAbortControllers[groupId];
          if (abortController) {
            abortController.abort('Session cleanup');
          }
        });

        // Clear all timers and abort controllers from state
        set(
          {
            supervisorDebounceTimers: {},
            supervisorDecisionAbortControllers: {},
          },
          false,
          n('cancelAllSupervisorDecisions'),
        );
      }
    },

    internal_updateSupervisorTodos: (groupId, topicId, todos) => {
      if (!groupId) return;

      const key = messageMapKey(groupId, topicId);

      set(
        produce((state: ChatStoreState) => {
          state.supervisorTodos[key] = todos;
        }),
        false,
        n(`internal_updateSupervisorTodos/${groupId}`),
      );
    },

    internal_createSupervisorErrorMessage: async (groupId: string, error: Error | string) => {
      const { internal_createTmpMessage, activeTopicId } = get();

      try {
        const errorMessage = error instanceof Error ? error.message : error;
        const groupConfig = selectGroupConfig(groupId);

        const supervisorMessage: CreateMessageParams = {
          role: 'supervisor',
          fromModel: groupConfig.orchestratorModel,
          fromProvider: groupConfig.orchestratorProvider,
          groupId,
          sessionId: useSessionStore.getState().activeId || groupId,
          topicId: activeTopicId,
          error: {
            type: ChatErrorType.SupervisorDecisionFailed,
            message: errorMessage,
          },
          content: LOADING_FLAT,
        };

        // Create a temporary message that only exists in UI state, no API call
        internal_createTmpMessage(supervisorMessage);
      } catch (createError) {
        console.error('Failed to create supervisor error message:', createError);
      }
    },
  };
};
