import type { ContextNode, IdNode, Message, MessageNode, SignalCallbacksNode } from '../types';

/**
 * Persisted external-signal lineage on `message.metadata.signal` —
 * mirrors `MessageSignal` in `@lobechat/types/message/common/metadata.ts`.
 * Locally duplicated to avoid a cross-package import for a single
 * structural type.
 *
 * Phase 2 (LOBE-8999) promotes this to a dedicated `messages.signal`
 * jsonb column. To migrate, swap the `metadata?.signal` lookup in
 * `getMessageSignal` below for `(msg as any).signal ?? msg.metadata?.signal`
 * — UI and node shape are unchanged.
 */
interface MessageSignal {
  sequence?: number;
  sourceToolCallId: string;
  sourceToolName: string;
  type: 'tool-stdout' | 'tool-callback';
}

/**
 * Read the external-signal lineage from a message. Returns undefined
 * when the message has tools (LLM was on the main chain, not reacting
 * to a signal) — the writer attaches the tag at stream_start before it
 * knows whether the step will end up using tools, so the collector
 * must defang that mismatch here.
 *
 * Phase 2 compat seam (LOBE-8999): when the `messages.signal` column
 * lands, prefer it over `metadata.signal`.
 */
const getMessageSignal = (msg: Message): MessageSignal | undefined => {
  if (msg.role !== 'assistant') return undefined;
  if (msg.tools && msg.tools.length > 0) return undefined;
  return (msg.metadata as { signal?: MessageSignal } | undefined | null)?.signal;
};

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
      // This ensures that messages after a task are not merged into the AssistantGroup before the task
      const taskChildren = nextMessages.filter((m) => m.role === 'task');
      if (taskChildren.length > 0) {
        continue;
      }

      for (const nextMsg of nextMessages) {
        // Only continue if the next assistant has the SAME agentId
        // Different agentId means it's a different agent responding (e.g., via speak tool)
        const isSameAgent = nextMsg.agentId === groupAgentId;
        // Skip signal-tagged toolless callbacks (LOBE-8998) — they're a
        // side-channel under the same parent tool and get collected
        // separately by `collectFlatSignalCallbacks`.
        if (getMessageSignal(nextMsg)) continue;

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
   * Flat-list variant of {@link collectSignalCallbacks} — finds signal
   * callback blocks (Monitor stdout pushes, etc.) for an assistant
   * chain that's already been collected from the flat messages array.
   *
   * Returns one entry per source tool that fired callbacks, in source
   * tool encounter order. Each entry's `callbacks` are ordered by
   * `metadata.signal.sequence`.
   *
   * Caller is responsible for marking returned messages as processed.
   */
  collectFlatSignalCallbacks(
    allToolMessages: Message[],
    allMessages: Message[],
  ): {
    callbacks: Message[];
    sourceToolCallId: string;
    sourceToolMessageId: string;
    sourceToolName: string;
  }[] {
    const blocks: {
      callbacks: Message[];
      sourceToolCallId: string;
      sourceToolMessageId: string;
      sourceToolName: string;
    }[] = [];

    for (const toolMsg of allToolMessages) {
      const children = allMessages.filter((m) => m.parentId === toolMsg.id);
      const callbacks: Message[] = [];
      for (const child of children) {
        if (!getMessageSignal(child)) continue;
        callbacks.push(child);
      }
      if (callbacks.length === 0) continue;

      callbacks.sort((a, b) => {
        const sa = getMessageSignal(a)?.sequence ?? Number.POSITIVE_INFINITY;
        const sb = getMessageSignal(b)?.sequence ?? Number.POSITIVE_INFINITY;
        return sa - sb;
      });
      const first = getMessageSignal(callbacks[0])!;
      blocks.push({
        callbacks,
        sourceToolCallId: first.sourceToolCallId,
        sourceToolMessageId: toolMsg.id,
        sourceToolName: first.sourceToolName,
      });
    }
    return blocks;
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

      // Stop if there are ANY task children - they should be processed separately, not part of AssistantGroup
      // This ensures that messages after a task are not merged into the AssistantGroup before the task
      const taskChildren = toolNode.children.filter((child) => {
        const childMsg = this.messageMap.get(child.id);
        return childMsg?.role === 'task';
      });
      if (taskChildren.length > 0) {
        continue;
      }

      // Find the next main-chain assistant under this tool. Signal-tagged
      // toolless siblings (Monitor callbacks etc., LOBE-8998) share the
      // same parent tool but live on a side-channel — skip them here so
      // the main chain still walks the real follower. The signal blocks
      // are emitted separately by `collectSignalCallbacks`.
      for (const nextChild of toolNode.children) {
        const nextMsg = this.messageMap.get(nextChild.id);
        if (nextMsg?.role !== 'assistant') continue;
        if (nextMsg.agentId !== agentId) continue;
        if (getMessageSignal(nextMsg)) continue; // skip signal callbacks
        // Recursively collect this assistant and its descendants (same agent only)
        this.collectAssistantGroupMessages(nextMsg, nextChild, children, agentId);
        return; // Only follow one path
      }
    }
  }

  /**
   * Collect signal-callback blocks for an AssistantGroup — one
   * SignalCallbacksNode per source tool that fired signals (Monitor
   * stdout pushes triggering toolless follow-up turns, etc.).
   *
   * Walks the same main-chain as `collectAssistantGroupMessages` and,
   * for each tool encountered, looks at its children for assistants
   * carrying `metadata.signal`. Multiple source tools in the same
   * group produce multiple blocks, in source-tool encounter order.
   *
   * Blocks are emitted at the END of `AssistantGroupNode.children`
   * after the main-chain zigzag — see ContextTreeBuilder.
   */
  collectSignalCallbacks(message: Message, idNode: IdNode): SignalCallbacksNode[] {
    const groupAgentId = message.agentId;
    const blocks: SignalCallbacksNode[] = [];
    const visited = new Set<string>();

    const walk = (node: IdNode): void => {
      if (visited.has(node.id)) return;
      visited.add(node.id);

      for (const child of node.children) {
        const childMsg = this.messageMap.get(child.id);
        if (childMsg?.role !== 'tool') continue;

        // Gather signal-tagged toolless callbacks among this tool's
        // children. `getMessageSignal` already returns undefined for
        // tool-using assistants and non-assistants, so the filter is
        // straightforward.
        const callbacks: Message[] = [];
        for (const toolChild of child.children) {
          const toolChildMsg = this.messageMap.get(toolChild.id);
          if (!toolChildMsg) continue;
          if (!getMessageSignal(toolChildMsg)) continue;
          callbacks.push(toolChildMsg);
        }

        if (callbacks.length > 0) {
          // Sort by sequence; missing sequence sorts to the end.
          callbacks.sort((a, b) => {
            const sa = getMessageSignal(a)?.sequence ?? Number.POSITIVE_INFINITY;
            const sb = getMessageSignal(b)?.sequence ?? Number.POSITIVE_INFINITY;
            return sa - sb;
          });
          const first = getMessageSignal(callbacks[0])!;
          blocks.push({
            callbacks: callbacks.map((m) => ({ id: m.id, type: 'message' as const })),
            id: `signalCallbacks-${child.id}`,
            sourceToolCallId: first.sourceToolCallId,
            sourceToolMessageId: child.id,
            sourceToolName: first.sourceToolName,
            type: 'signalCallbacks',
          });
        }

        // Continue walking the main chain — recurse into the next
        // main-chain follower under this tool (skipping signal
        // callbacks, just like `collectAssistantGroupMessages` does).
        for (const nextChild of child.children) {
          const nextMsg = this.messageMap.get(nextChild.id);
          if (nextMsg?.role !== 'assistant') continue;
          if (nextMsg.agentId !== groupAgentId) continue;
          if (getMessageSignal(nextMsg)) continue;
          walk(nextChild);
          break;
        }
      }
    };

    walk(idNode);
    return blocks;
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

    // Check if lastNode is a tool with ANY task children
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

      // Stop if there are ANY task children - they should be processed separately, not part of AssistantGroup
      // This ensures that messages after a task are not merged into the AssistantGroup before the task
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
