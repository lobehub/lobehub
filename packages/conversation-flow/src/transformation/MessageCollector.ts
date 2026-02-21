import type { ContextNode, IdNode, Message, MessageNode } from '../types';

/**
 * MessageCollector - Handles collection of related messages
 *
 * Provides utilities for:
 * 1. Collecting messages in a group
 * 2. Collecting tool messages
 * 3. Collecting assistant chains
 * 4. Finding next messages in sequences
 */
export class MessageCollector {
  constructor(
    private messageMap: Map<string, Message>,
    private childrenMap: Map<string | null, string[]>,
  ) {}

  /**
   * Collect all messages belonging to a message group
   */
  collectGroupMembers(groupId: string, messages: Message[]): Message[] {
    return messages.filter((m) => m.groupId === groupId);
  }

  /**
   * Collect tool messages related to an assistant message
   */
  collectToolMessages(assistant: Message, messages: Message[]): Message[] {
    const toolCallIds = new Set(assistant.tools?.map((t) => t.id) || []);
    return messages.filter(
      (m) => m.role === 'tool' && m.tool_call_id && toolCallIds.has(m.tool_call_id),
    );
  }

  /**
   * Recursively collect the entire assistant chain
   * (assistant -> tools -> assistant -> tools -> ...)
   * Only collects messages from the SAME agent (matching agentId)
   */
  collectAssistantChain(
    currentAssistant: Message,
    allMessages: Message[],
    assistantChain: Message[],
    allToolMessages: Message[],
    processedIds: Set<string>,
  ): void {
    if (processedIds.has(currentAssistant.id)) return;

    // Add current assistant to chain
    assistantChain.push(currentAssistant);

    // Get the agentId of the first assistant in the chain (the group owner)
    const groupAgentId = assistantChain[0].agentId;

    // Collect its tool messages
    const toolMessages = this.collectToolMessages(currentAssistant, allMessages);
    allToolMessages.push(...toolMessages);

    // Find next assistant after tools
    for (const toolMsg of toolMessages) {
      // Stop if tool message has agentCouncil mode - its children belong to AgentCouncil
      if ((toolMsg.metadata as any)?.agentCouncil === true) {
        continue;
      }

      const nextMessages = allMessages.filter((m) => m.parentId === toolMsg.id);

      // Stop if there are task children - they should be handled separately, not part of AssistantGroup
      const taskChildren = nextMessages.filter((m) => m.role === 'task');
      if (taskChildren.length > 0) {
        continue;
      }

      for (const nextMsg of nextMessages) {
        // Only continue if the next assistant has the SAME agentId
        // Different agentId means it's a different agent responding (e.g., via speak tool)
        const isSameAgent = nextMsg.agentId === groupAgentId;

        if (
          nextMsg.role === 'assistant' &&
          nextMsg.tools &&
          nextMsg.tools.length > 0 &&
          isSameAgent
        ) {
          // Continue the chain only for same agent
          this.collectAssistantChain(
            nextMsg,
            allMessages,
            assistantChain,
            allToolMessages,
            processedIds,
          );
          return;
        } else if (nextMsg.role === 'assistant' && isSameAgent) {
          // Final assistant without tools (same agent)
          assistantChain.push(nextMsg);
          return;
        }
        // If different agentId, don't add to chain - let it be processed separately
      }
    }
  }

  /**
   * Recursively collect assistant messages for an AssistantGroup (contextTree version)
   * Only collects messages from the SAME agent (matching agentId)
   */
  collectAssistantGroupMessages(
    message: Message,
    idNode: IdNode,
    children: ContextNode[],
    groupAgentId?: string,
  ): void {
    // Get the agentId of the first assistant in the group (the group owner)
    const agentId = groupAgentId ?? message.agentId;

    // Get tool message IDs if this assistant has tools
    const toolIds = idNode.children
      .filter((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role === 'tool';
      })
      .map((child) => child.id);

    // Add current assistant message node
    const messageNode: MessageNode = {
      id: message.id,
      type: 'message',
    };
    if (toolIds.length > 0) {
      messageNode.tools = toolIds;
    }
    children.push(messageNode);

    // Find next assistant message after tools
    for (const toolNode of idNode.children) {
      const toolMsg = this.messageMap.get(toolNode.id);
      if (toolMsg?.role !== 'tool') continue;

      // Stop if tool message has agentCouncil mode - its children belong to AgentCouncil
      if ((toolMsg.metadata as any)?.agentCouncil === true) {
        continue;
      }

      // Stop if there are task children - they should be handled separately, not part of AssistantGroup
      const taskChildren = toolNode.children.filter((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role === 'task';
      });
      if (taskChildren.length > 0) {
        continue;
      }

      // Check if tool has an assistant child
      if (toolNode.children.length > 0) {
        const nextChild = toolNode.children[0];
        const nextMsg = this.messageMap.get(nextChild.id);

        // Only continue if the next assistant has the SAME agentId
        if (nextMsg?.role === 'assistant' && nextMsg.agentId === agentId) {
          // Recursively collect this assistant and its descendants (same agent only)
          this.collectAssistantGroupMessages(nextMsg, nextChild, children, agentId);
          return; // Only follow one path
        }
      }
    }
  }

  /**
   * Find next message after tools in an assistant group
   */
  findNextAfterTools(assistantMsg: Message, idNode: IdNode): IdNode | null {
    // Recursively find the last message in the assistant group (same agentId only)
    const lastNode = this.findLastNodeInAssistantGroup(idNode, assistantMsg.agentId);
    if (!lastNode) return null;

    // Check if lastNode is a tool with agentCouncil mode
    // In this case, return the tool node itself so ContextTreeBuilder can process it
    const lastMsg = this.messageMap.get(lastNode.id);
    if (lastMsg?.role === 'tool' && (lastMsg.metadata as any)?.agentCouncil === true) {
      return lastNode;
    }

    // Check if lastNode is a tool with task children
    // In this case, return the tool node itself so ContextTreeBuilder can process tasks
    if (lastMsg?.role === 'tool') {
      const taskChildren = lastNode.children.filter((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role === 'task';
      });
      if (taskChildren.length > 0) {
        return lastNode;
      }
    }

    // Otherwise, return the first child of the last node
    if (lastNode.children.length > 0) {
      return lastNode.children[0];
    }
    return null;
  }

  /**
   * Find the last node in an AssistantGroup sequence
   * Only follows messages from the SAME agent (matching agentId)
   */
  findLastNodeInAssistantGroup(idNode: IdNode, groupAgentId?: string): IdNode | null {
    // Check if has tool children
    const toolChildren = idNode.children.filter((child) => {
      const childMsg = this.messageMap.get(child.id);
      return childMsg?.role === 'tool';
    });

    if (toolChildren.length === 0) {
      return idNode;
    }

    // Check if any tool has an assistant child with the same agentId
    for (const toolNode of toolChildren) {
      const toolMsg = this.messageMap.get(toolNode.id);

      // Stop if tool message has agentCouncil mode - its children belong to AgentCouncil
      if ((toolMsg?.metadata as any)?.agentCouncil === true) {
        continue;
      }

      // Stop if there are task children - they should be handled separately, not part of AssistantGroup
      const taskNodes = toolNode.children.filter((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role === 'task';
      });
      if (taskNodes.length > 0) {
        continue;
      }

      if (toolNode.children.length > 0) {
        const nextChild = toolNode.children[0];
        const nextMsg = this.messageMap.get(nextChild.id);

        // Only continue if the next assistant has the SAME agentId
        if (nextMsg?.role === 'assistant' && nextMsg.agentId === groupAgentId) {
          // Continue following the assistant chain (same agent only)
          return this.findLastNodeInAssistantGroup(nextChild, groupAgentId);
        }
      }
    }

    // No more assistant messages from the same agent, return the last tool node
    return toolChildren.at(-1) ?? null;
  }
}
