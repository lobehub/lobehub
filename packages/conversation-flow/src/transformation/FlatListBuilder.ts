import type { AssistantContentBlock, ChatToolPayloadWithResult } from '@lobechat/types';

import type { Message, MessageGroupMetadata } from '../types';
import type { BranchResolver } from './BranchResolver';
import type { MessageCollector } from './MessageCollector';
import type { MessageTransformer } from './MessageTransformer';

/**
 * FlatListBuilder - Builds flat message list following the active path
 *
 * Handles:
 * 1. Recursive traversal following active branches
 * 2. Creating virtual messages for Compare and AssistantGroup
 * 3. Processing different message types with priority
 */
export class FlatListBuilder {
  constructor(
    private messageMap: Map<string, Message>,
    private messageGroupMap: Map<string, MessageGroupMetadata>,
    private childrenMap: Map<string | null, string[]>,
    private branchResolver: BranchResolver,
    private messageCollector: MessageCollector,
    private messageTransformer: MessageTransformer,
  ) {}

  /**
   * Generate flatList from messages array
   * Only includes messages in the active path
   */
  flatten(messages: Message[]): Message[] {
    const flatList: Message[] = [];
    const processedIds = new Set<string>();

    // Build the active path by traversing from root
    this.buildFlatListRecursive(null, flatList, processedIds, messages);

    return flatList;
  }

  /**
   * Recursively build flatList following the active path
   */
  private buildFlatListRecursive(
    parentId: string | null,
    flatList: Message[],
    processedIds: Set<string>,
    allMessages: Message[],
  ): void {
    const children = this.childrenMap.get(parentId) ?? [];

    // Pre-loop check: AgentCouncil mode on parent (tool message with multiple assistant children)
    // This handles the case when we continue from a tool message that triggered broadcast
    if (parentId) {
      const parentMessage = this.messageMap.get(parentId);
      if (parentMessage && this.isAgentCouncilMode(parentMessage) && children.length > 1) {
        // Create agentCouncil virtual message from the parent tool message
        const agentCouncilMessage = this.createAgentCouncilMessageFromChildIds(
          parentMessage,
          children,
          allMessages,
          processedIds,
        );
        flatList.push(agentCouncilMessage);

        // Continue processing children of the last member (for supervisor final reply)
        // The last member's children should be processed next
        const lastMemberId = children.at(-1);
        if (lastMemberId) {
          this.buildFlatListRecursive(lastMemberId, flatList, processedIds, allMessages);
        }
        return;
      }

      // Pre-loop check: Tasks aggregation (multiple task messages with same parentId)
      // This handles the case when multiple async tasks are spawned from the same tool message
      if (parentMessage && children.length > 0) {
        const taskChildren = children.filter((childId) => {
          const child = this.messageMap.get(childId);
          return child?.role === 'task';
        });

        if (taskChildren.length > 1) {
          // Get non-task children (e.g., summary assistant message)
          const nonTaskChildren = children.filter((childId) => {
            const child = this.messageMap.get(childId);
            return child?.role !== 'task';
          });

          // Create tasks virtual message
          const tasksMessage = this.createTasksMessage(parentMessage, taskChildren, processedIds);
          flatList.push(tasksMessage);

          // Continue with non-task children (e.g., final summary from assistant)
          for (const nonTaskChildId of nonTaskChildren) {
            if (!processedIds.has(nonTaskChildId)) {
              const nonTaskChild = this.messageMap.get(nonTaskChildId);
              if (nonTaskChild) {
                flatList.push(nonTaskChild);
                processedIds.add(nonTaskChildId);
                this.buildFlatListRecursive(nonTaskChildId, flatList, processedIds, allMessages);
              }
            }
          }
          return;
        }
      }
    }

    for (const childId of children) {
      if (processedIds.has(childId)) continue;

      const message = this.messageMap.get(childId);
      if (!message) continue;

      // Priority 1: Compare message group
      const messageGroup = message.groupId ? this.messageGroupMap.get(message.groupId) : undefined;

      if (messageGroup && messageGroup.mode === 'compare' && !processedIds.has(messageGroup.id)) {
        const groupMembers = this.messageCollector.collectGroupMembers(
          message.groupId!,
          allMessages,
        );
        const compareMessage = this.createCompareMessage(messageGroup, groupMembers);
        flatList.push(compareMessage);
        groupMembers.forEach((m) => processedIds.add(m.id));
        processedIds.add(messageGroup.id);

        // Continue with active column's children (if any)
        if ((compareMessage as any).activeColumnId) {
          this.buildFlatListRecursive(
            (compareMessage as any).activeColumnId,
            flatList,
            processedIds,
            allMessages,
          );
        }
        continue;
      }

      // Priority 2: AssistantGroup (assistant + tools)
      if (message.role === 'assistant' && message.tools && message.tools.length > 0) {
        // Collect the entire assistant group chain
        const assistantChain: Message[] = [];
        const allToolMessages: Message[] = [];
        this.messageCollector.collectAssistantChain(
          message,
          allMessages,
          assistantChain,
          allToolMessages,
          processedIds,
        );

        // Create assistantGroup virtual message
        const groupMessage = this.createAssistantGroupMessage(
          assistantChain[0],
          assistantChain,
          allToolMessages,
        );
        flatList.push(groupMessage);

        // Mark all as processed
        assistantChain.forEach((m) => processedIds.add(m.id));
        allToolMessages.forEach((m) => processedIds.add(m.id));

        // Continue after the assistant chain
        // Priority 1: If last assistant has non-tool children, continue from it
        // Priority 2: Otherwise continue from tools (for cases where user replies to tool)
        const lastAssistant = assistantChain.at(-1);
        const toolIds = new Set(allToolMessages.map((t) => t.id));

        const lastAssistantNonToolChildren = lastAssistant
          ? this.childrenMap.get(lastAssistant.id)?.filter((childId) => !toolIds.has(childId))
          : undefined;

        if (
          lastAssistantNonToolChildren &&
          lastAssistantNonToolChildren.length > 0 &&
          lastAssistant
        ) {
          // Follow-up messages exist after the last assistant (not tools)
          this.buildFlatListRecursive(lastAssistant.id, flatList, processedIds, allMessages);
        } else {
          // No non-tool children of last assistant, check tools for children
          for (const toolMsg of allToolMessages) {
            this.buildFlatListRecursive(toolMsg.id, flatList, processedIds, allMessages);
          }
        }
        continue;
      }

      // Priority 2b: Supervisor message without tools (content-only)
      // Transform to supervisor role with content in children array
      if (
        message.role === 'assistant' &&
        message.metadata?.isSupervisor &&
        (!message.tools || message.tools.length === 0)
      ) {
        const supervisorMessage = this.createSupervisorContentMessage(message);
        flatList.push(supervisorMessage);
        processedIds.add(message.id);

        // Continue with children
        this.buildFlatListRecursive(message.id, flatList, processedIds, allMessages);
        continue;
      }

      // Priority 3a: Compare mode from user message metadata
      const childMessages = this.childrenMap.get(message.id) ?? [];
      if (this.isCompareMode(message) && childMessages.length > 1) {
        // Add user message
        flatList.push(message);
        processedIds.add(message.id);

        // Create compare virtual message with proper handling of AssistantGroups
        const compareMessage = this.createCompareMessageFromChildIds(
          message,
          childMessages,
          allMessages,
          processedIds,
        );
        flatList.push(compareMessage);

        // Continue with active column's children (if any)
        if ((compareMessage as any).activeColumnId) {
          this.buildFlatListRecursive(
            (compareMessage as any).activeColumnId,
            flatList,
            processedIds,
            allMessages,
          );
        }
        continue;
      }

      // Priority 3b: AgentCouncil mode (from message metadata, typically on tool messages)
      if (this.isAgentCouncilMode(message) && childMessages.length > 1) {
        // Create agentCouncil virtual message with proper handling of AssistantGroups
        const agentCouncilMessage = this.createAgentCouncilMessageFromChildIds(
          message,
          childMessages,
          allMessages,
          processedIds,
        );
        flatList.push(agentCouncilMessage);

        // AgentCouncil doesn't continue - all columns are parallel endpoints
        // The conversation continues after the supervisor completes orchestration
        continue;
      }

      // Priority 3d: User message with branches (multiple assistant children)
      // Branch indicator should be on the active assistant child message
      if (message.role === 'user' && childMessages.length > 1) {
        const activeBranchId = this.branchResolver.getActiveBranchIdFromMetadata(
          message,
          childMessages,
          this.childrenMap,
        );

        // Optimistic update: activeBranchId is undefined when branch is being created
        // In this case, just add user message without branch info and continue
        if (!activeBranchId) {
          flatList.push(message);
          processedIds.add(message.id);
          continue;
        }

        // Add user message without branch (branch goes on the child)
        flatList.push(message);
        processedIds.add(message.id);

        const activeBranchIndex = childMessages.indexOf(activeBranchId);

        // Continue with active branch - check if it's an assistantGroup
        const activeBranchMsg = this.messageMap.get(activeBranchId);
        if (activeBranchMsg) {
          // Check if active branch is assistant with tools (should be assistantGroup)
          if (
            activeBranchMsg.role === 'assistant' &&
            activeBranchMsg.tools &&
            activeBranchMsg.tools.length > 0
          ) {
            // Collect the entire assistant group chain
            const assistantChain: Message[] = [];
            const allToolMessages: Message[] = [];
            this.messageCollector.collectAssistantChain(
              activeBranchMsg,
              allMessages,
              assistantChain,
              allToolMessages,
              processedIds,
            );

            // Create assistantGroup virtual message with branch metadata
            const groupMessage = this.createAssistantGroupMessage(
              assistantChain[0],
              assistantChain,
              allToolMessages,
            );
            // Add branch info to the assistantGroup message
            const groupMessageWithBranches = this.createMessageWithBranches(
              groupMessage,
              childMessages.length,
              activeBranchIndex,
            );
            flatList.push(groupMessageWithBranches);

            // Mark all as processed
            assistantChain.forEach((m) => processedIds.add(m.id));
            allToolMessages.forEach((m) => processedIds.add(m.id));

            // Continue after the assistant chain
            const lastAssistant = assistantChain.at(-1);
            const toolIds = new Set(allToolMessages.map((t) => t.id));

            const lastAssistantNonToolChildren = lastAssistant
              ? this.childrenMap.get(lastAssistant.id)?.filter((childId) => !toolIds.has(childId))
              : undefined;

            if (
              lastAssistantNonToolChildren &&
              lastAssistantNonToolChildren.length > 0 &&
              lastAssistant
            ) {
              this.buildFlatListRecursive(lastAssistant.id, flatList, processedIds, allMessages);
            } else {
              for (const toolMsg of allToolMessages) {
                this.buildFlatListRecursive(toolMsg.id, flatList, processedIds, allMessages);
              }
            }
          } else {
            // Regular assistant message (not assistantGroup) - add branch info
            const activeBranchWithBranches = this.createMessageWithBranches(
              activeBranchMsg,
              childMessages.length,
              activeBranchIndex,
            );
            flatList.push(activeBranchWithBranches);
            processedIds.add(activeBranchId);

            // Continue with active branch's children
            this.buildFlatListRecursive(activeBranchId, flatList, processedIds, allMessages);
          }
        }
        continue;
      }

      // Priority 3e: Assistant message with branches (multiple user children)
      // Branch indicator should be on the active user child message
      if (message.role === 'assistant' && childMessages.length > 1) {
        const activeBranchId = this.branchResolver.getActiveBranchIdFromMetadata(
          message,
          childMessages,
          this.childrenMap,
        );

        // Optimistic update: activeBranchId is undefined when branch is being created
        // In this case, just add assistant message without branch info and continue
        if (!activeBranchId) {
          flatList.push(message);
          processedIds.add(message.id);
          continue;
        }

        // Add the assistant message without branch (branch goes on the child)
        flatList.push(message);
        processedIds.add(message.id);

        const activeBranchIndex = childMessages.indexOf(activeBranchId);

        // Continue with active branch and add branch info to the user child
        const activeBranchMsg = this.messageMap.get(activeBranchId);
        if (activeBranchMsg) {
          // Add branch info to the active user child message
          const activeBranchWithBranches = this.createMessageWithBranches(
            activeBranchMsg,
            childMessages.length,
            activeBranchIndex,
          );
          flatList.push(activeBranchWithBranches);
          processedIds.add(activeBranchId);

          // Continue with active branch's children
          this.buildFlatListRecursive(activeBranchId, flatList, processedIds, allMessages);
        }
        continue;
      }

      // Priority 4: Regular message
      flatList.push(message);
      processedIds.add(message.id);

      // Continue with children
      this.buildFlatListRecursive(message.id, flatList, processedIds, allMessages);
    }
  }

  /**
   * Check if message has compare mode in metadata
   */
  private isCompareMode(message: Message): boolean {
    return (message.metadata as any)?.compare === true;
  }

  /**
   * Check if message has agentCouncil mode in metadata
   * Used for multi-agent parallel responses (broadcast scenario)
   */
  private isAgentCouncilMode(message: Message): boolean {
    return (message.metadata as any)?.agentCouncil === true;
  }

  /**
   * Create compare virtual message from child IDs with AssistantGroup support
   */
  private createCompareMessageFromChildIds(
    parentMessage: Message,
    childIds: string[],
    allMessages: Message[],
    processedIds: Set<string>,
  ): Message {
    const columns: Message[][] = [];
    const columnFirstIds: string[] = [];
    let activeColumnId: string | undefined;

    // Process each child (column)
    for (const childId of childIds) {
      const childMessage = this.messageMap.get(childId);
      if (!childMessage) continue;

      columnFirstIds.push(childId);

      // Check if this message is marked as active column
      if ((childMessage.metadata as any)?.activeColumn === true) {
        activeColumnId = childId;
      }

      // Check if this child is an AssistantGroup
      if (
        childMessage.role === 'assistant' &&
        childMessage.tools &&
        childMessage.tools.length > 0
      ) {
        // Collect the entire assistant group chain for this column
        const assistantChain: Message[] = [];
        const allToolMessages: Message[] = [];
        const columnProcessedIds = new Set<string>();

        this.messageCollector.collectAssistantChain(
          childMessage,
          allMessages,
          assistantChain,
          allToolMessages,
          columnProcessedIds,
        );

        // Create assistantGroup virtual message for this column
        const groupMessage = this.createAssistantGroupMessage(
          assistantChain[0],
          assistantChain,
          allToolMessages,
        );

        columns.push([groupMessage]);

        // Mark all as processed
        assistantChain.forEach((m) => processedIds.add(m.id));
        allToolMessages.forEach((m) => processedIds.add(m.id));
      } else {
        // Regular message (not an AssistantGroup)
        columns.push([childMessage]);
        processedIds.add(childId);
      }
    }

    // Generate ID with all column first message IDs
    const columnIdsStr = columnFirstIds.join('-');
    const compareId = `compare-${parentMessage.id}-${columnIdsStr}`;

    // Calculate timestamps from first column's messages
    const firstColumnMessages = childIds.map((id) => this.messageMap.get(id)).filter(Boolean);
    const createdAt =
      firstColumnMessages.length > 0
        ? Math.min(...firstColumnMessages.map((m) => m!.createdAt))
        : parentMessage.createdAt;
    const updatedAt =
      firstColumnMessages.length > 0
        ? Math.max(...firstColumnMessages.map((m) => m!.updatedAt))
        : parentMessage.updatedAt;

    return {
      activeColumnId,
      columns: columns as any,
      content: '',
      createdAt,
      extra: {
        parentMessageId: parentMessage.id,
      },
      id: compareId,
      role: 'compare' as any,
      updatedAt,
    } as Message;
  }

  /**
   * Create agentCouncil virtual message from child IDs with AssistantGroup support
   * Each member is a single message (not an array)
   */
  private createAgentCouncilMessageFromChildIds(
    parentMessage: Message,
    childIds: string[],
    allMessages: Message[],
    processedIds: Set<string>,
  ): Message {
    const members: Message[] = [];
    const memberIds: string[] = [];

    // Process each child (member)
    for (const childId of childIds) {
      const childMessage = this.messageMap.get(childId);
      if (!childMessage) continue;

      memberIds.push(childId);

      // Check if this child is an AssistantGroup (agent with tool calls)
      if (
        childMessage.role === 'assistant' &&
        childMessage.tools &&
        childMessage.tools.length > 0
      ) {
        // Collect the entire assistant group chain for this member
        const assistantChain: Message[] = [];
        const allToolMessages: Message[] = [];
        const memberProcessedIds = new Set<string>();

        this.messageCollector.collectAssistantChain(
          childMessage,
          allMessages,
          assistantChain,
          allToolMessages,
          memberProcessedIds,
        );

        // Create assistantGroup virtual message for this member
        const groupMessage = this.createAssistantGroupMessage(
          assistantChain[0],
          assistantChain,
          allToolMessages,
        );

        members.push(groupMessage);

        // Mark all as processed
        assistantChain.forEach((m) => processedIds.add(m.id));
        allToolMessages.forEach((m) => processedIds.add(m.id));
      } else {
        // Regular message (not an AssistantGroup)
        members.push(childMessage);
        processedIds.add(childId);
      }
    }

    // Generate ID with all member message IDs
    const memberIdsStr = memberIds.join('-');
    const agentCouncilId = `agentCouncil-${parentMessage.id}-${memberIdsStr}`;

    // Calculate timestamps from all member messages
    const allMemberMessages = childIds.map((id) => this.messageMap.get(id)).filter(Boolean);
    const createdAt =
      allMemberMessages.length > 0
        ? Math.min(...allMemberMessages.map((m) => m!.createdAt))
        : parentMessage.createdAt;
    const updatedAt =
      allMemberMessages.length > 0
        ? Math.max(...allMemberMessages.map((m) => m!.updatedAt))
        : parentMessage.updatedAt;

    return {
      content: '',
      createdAt,
      extra: {
        parentMessageId: parentMessage.id,
      },
      id: agentCouncilId,
      // members is a flat array of messages (not nested arrays)
      members: members as any,
      role: 'agentCouncil' as any,
      updatedAt,
    } as Message;
  }

  /**
   * Create compare virtual message (for group-based compare)
   */
  private createCompareMessage(group: MessageGroupMetadata, members: Message[]): Message {
    // Find active column ID from members metadata
    const activeColumnId = members.find((msg) => (msg.metadata as any)?.activeColumn === true)?.id;

    // columns contain full Message objects
    const columns: Message[][] = members.map((msg) => [msg]);

    return {
      activeColumnId,
      columns: columns as any,
      content: '',
      createdAt: Math.min(...members.map((m) => m.createdAt)),
      extra: {
        groupMode: group.mode,
        parentMessageId: group.parentMessageId,
      },
      id: group.id,
      role: 'compare' as any,
      updatedAt: Math.max(...members.map((m) => m.updatedAt)),
    } as Message;
  }

  /**
   * Create assistant group virtual message from entire chain
   */
  private createAssistantGroupMessage(
    firstAssistant: Message,
    assistantChain: Message[],
    allToolMessages: Message[],
  ): Message {
    const children: AssistantContentBlock[] = [];

    // Create tool map for lookup
    const toolMap = new Map<string, Message>();
    allToolMessages.forEach((tm) => {
      if (tm.tool_call_id) {
        toolMap.set(tm.tool_call_id, tm);
      }
    });

    // Process each assistant in the chain
    for (const assistant of assistantChain) {
      // Build toolsWithResults for this assistant
      const toolsWithResults: ChatToolPayloadWithResult[] =
        assistant.tools?.map((tool) => {
          const toolMsg = toolMap.get(tool.id);
          if (toolMsg) {
            const result: any = {
              content: toolMsg.content || '',
              id: toolMsg.id,
            };
            if (toolMsg.error) result.error = toolMsg.error;
            if (toolMsg.pluginState) result.state = toolMsg.pluginState;

            const toolWithResult: ChatToolPayloadWithResult = {
              ...tool,
              intervention: toolMsg.pluginIntervention,
              result,
              result_msg_id: toolMsg.id,
            };

            return toolWithResult;
          }
          return tool;
        }) || [];

      // Prefer top-level usage/performance fields, fall back to metadata
      const { usage: metaUsage, performance: metaPerformance } =
        this.messageTransformer.splitMetadata(assistant.metadata);
      const msgUsage = assistant.usage || metaUsage;
      const msgPerformance = assistant.performance || metaPerformance;

      // Extract non-usage/performance metadata fields
      const otherMetadata: Record<string, any> = {};
      if (assistant.metadata) {
        const usagePerformanceFields = new Set([
          'acceptedPredictionTokens',
          'cost',
          'duration',
          'inputAudioTokens',
          'inputCacheMissTokens',
          'inputCachedTokens',
          'inputCitationTokens',
          'inputImageTokens',
          'inputTextTokens',
          'inputWriteCacheTokens',
          'latency',
          'outputAudioTokens',
          'outputImageTokens',
          'outputReasoningTokens',
          'outputTextTokens',
          'rejectedPredictionTokens',
          'totalInputTokens',
          'totalOutputTokens',
          'totalTokens',
          'tps',
          'ttft',
        ]);

        Object.entries(assistant.metadata).forEach(([key, value]) => {
          if (!usagePerformanceFields.has(key)) {
            otherMetadata[key] = value;
          }
        });
      }

      const childBlock: AssistantContentBlock = {
        content: assistant.content || '',
        id: assistant.id,
      } as AssistantContentBlock;

      if (assistant.error) childBlock.error = assistant.error;
      if (assistant.fileList && assistant.fileList.length > 0)
        childBlock.fileList = assistant.fileList;
      if (assistant.imageList && assistant.imageList.length > 0)
        childBlock.imageList = assistant.imageList;
      if (msgPerformance) childBlock.performance = msgPerformance;
      if (assistant.reasoning) childBlock.reasoning = assistant.reasoning;
      if (toolsWithResults.length > 0) childBlock.tools = toolsWithResults;
      if (msgUsage) childBlock.usage = msgUsage;
      if (Object.keys(otherMetadata).length > 0) {
        childBlock.metadata = otherMetadata;
      }

      children.push(childBlock);
    }

    const aggregated = this.messageTransformer.aggregateMetadata(children);

    // Collect all non-usage/performance metadata from all children
    const groupMetadata: Record<string, any> = {};
    children.forEach((child) => {
      if ((child as any).metadata) {
        Object.assign(groupMetadata, (child as any).metadata);
      }
    });

    // If there's group-level metadata, apply it to first child and remove from others
    if (Object.keys(groupMetadata).length > 0 && children.length > 0) {
      // Ensure first child has the group metadata
      if (!(children[0] as any).metadata) {
        (children[0] as any).metadata = {};
      }
      Object.assign((children[0] as any).metadata, groupMetadata);

      // Remove metadata from subsequent children (keep only in first child)
      for (let i = 1; i < children.length; i++) {
        delete (children[i] as any).metadata;
      }
    }

    // Determine role: use 'supervisor' for supervisor messages, otherwise 'assistantGroup'
    const isSupervisor = firstAssistant.metadata?.isSupervisor;
    const role = isSupervisor ? 'supervisor' : 'assistantGroup';

    const result: Message = {
      ...firstAssistant,
      children,
      content: '',
      role: role as any,
    };

    // Remove fields that should not be in assistantGroup/supervisor
    delete result.imageList;
    delete result.metadata;
    delete result.reasoning;
    delete result.tools;

    // Add aggregated fields if they exist
    if (aggregated.performance) result.performance = aggregated.performance;
    if (aggregated.usage) result.usage = aggregated.usage;

    // Add group-level metadata if it exists
    if (Object.keys(groupMetadata).length > 0) {
      result.metadata = groupMetadata;
    }

    // Preserve isSupervisor in metadata for supervisor messages
    if (isSupervisor) {
      result.metadata = { ...result.metadata, isSupervisor: true };
    }

    return result;
  }

  /**
   * Create message with branch metadata
   * Used for both user and assistant messages that have multiple branches
   */
  private createMessageWithBranches(
    message: Message,
    count: number,
    activeBranchIndex: number,
  ): Message {
    return {
      ...message,
      branch: {
        activeBranchIndex,
        count,
      },
    } as Message;
  }

  /**
   * Create supervisor virtual message for content-only supervisor messages
   * Moves content to children array similar to assistantGroup
   */
  private createSupervisorContentMessage(message: Message): Message {
    // Prefer top-level usage/performance fields, fall back to metadata
    const { usage: metaUsage, performance: metaPerformance } =
      this.messageTransformer.splitMetadata(message.metadata);
    const msgUsage = message.usage || metaUsage;
    const msgPerformance = message.performance || metaPerformance;

    // Extract non-usage/performance metadata fields
    const otherMetadata: Record<string, any> = {};
    if (message.metadata) {
      const usagePerformanceFields = new Set([
        'acceptedPredictionTokens',
        'cost',
        'duration',
        'inputAudioTokens',
        'inputCacheMissTokens',
        'inputCachedTokens',
        'inputCitationTokens',
        'inputImageTokens',
        'inputTextTokens',
        'inputWriteCacheTokens',
        'latency',
        'outputAudioTokens',
        'outputImageTokens',
        'outputReasoningTokens',
        'outputTextTokens',
        'rejectedPredictionTokens',
        'totalInputTokens',
        'totalOutputTokens',
        'totalTokens',
        'tps',
        'ttft',
      ]);

      Object.entries(message.metadata).forEach(([key, value]) => {
        if (!usagePerformanceFields.has(key)) {
          otherMetadata[key] = value;
        }
      });
    }

    // Create the child content block
    const childBlock: any = {
      content: message.content || '',
      id: message.id,
    };

    if (message.error) childBlock.error = message.error;
    if (message.fileList && message.fileList.length > 0) childBlock.fileList = message.fileList;
    if (message.imageList && message.imageList.length > 0) childBlock.imageList = message.imageList;
    if (msgPerformance) childBlock.performance = msgPerformance;
    if (message.reasoning) childBlock.reasoning = message.reasoning;
    if (msgUsage) childBlock.usage = msgUsage;
    if (Object.keys(otherMetadata).length > 0) {
      childBlock.metadata = otherMetadata;
    }

    const result: Message = {
      ...message,
      children: [childBlock],
      content: '',
      role: 'supervisor' as any,
    };

    // Remove fields that should not be in supervisor message
    delete result.imageList;
    delete result.metadata;
    delete result.reasoning;
    delete result.tools;

    // Add aggregated fields if they exist
    if (msgPerformance) result.performance = msgPerformance;
    if (msgUsage) result.usage = msgUsage;

    // Preserve isSupervisor in metadata
    result.metadata = { isSupervisor: true, ...otherMetadata };

    return result;
  }

  /**
   * Create tasks virtual message from multiple task children
   * Aggregates task messages with the same parentId into a single tasks message
   */
  private createTasksMessage(
    parentMessage: Message,
    taskChildIds: string[],
    processedIds: Set<string>,
  ): Message {
    const taskMessages: Message[] = [];

    for (const taskId of taskChildIds) {
      const taskMessage = this.messageMap.get(taskId);
      if (taskMessage) {
        taskMessages.push(taskMessage);
        processedIds.add(taskId);
      }
    }

    // Sort by createdAt to maintain order
    taskMessages.sort((a, b) => a.createdAt - b.createdAt);

    // Generate ID with parent message id and all task message ids
    const taskIdsStr = taskMessages.map((t) => t.id).join('-');
    const tasksId = `tasks-${parentMessage.id}-${taskIdsStr}`;

    // Calculate timestamps from task messages
    const createdAt =
      taskMessages.length > 0
        ? Math.min(...taskMessages.map((m) => m.createdAt))
        : parentMessage.createdAt;
    const updatedAt =
      taskMessages.length > 0
        ? Math.max(...taskMessages.map((m) => m.updatedAt))
        : parentMessage.updatedAt;

    return {
      content: '',
      createdAt,
      extra: {
        parentMessageId: parentMessage.id,
      },
      id: tasksId,
      role: 'tasks' as any,
      tasks: taskMessages as any,
      updatedAt,
    } as Message;
  }
}
