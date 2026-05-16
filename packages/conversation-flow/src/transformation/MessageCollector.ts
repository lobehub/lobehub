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
  type: 'tool-stdout' | 'tool-callback' | 'task-completion';
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

/** `tool-stdout` / `tool-callback` — reactive callback turns rendered inside the SignalCallbacks accordion. */
const isCallbackSignal = (sig: MessageSignal | undefined): boolean =>
  sig?.type === 'tool-stdout' || sig?.type === 'tool-callback';

/** `task-completion` — post-task summary, rendered as a plain message AFTER the SignalCallbacks block. */
const isTaskCompletionSignal = (sig: MessageSignal | undefined): boolean =>
  sig?.type === 'task-completion';

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
        if (!isCallbackSignal(getMessageSignal(child))) continue;
        callbacks.push(child);
      }
      if (callbacks.length === 0) continue;
      // (task-completion siblings are emitted separately by
      // `collectFlatTaskCompletions` so they land in the parent
      // AssistantGroup after the callbacks accordion.)

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
   * Flat-list variant — find post-task-summary assistants (LOBE-8998),
   * i.e. toolless assistants tagged with
   * `metadata.signal.type === 'task-completion'`, fired by the LLM after
   * CC delivers `task_notification` for a long-running tool.
   *
   * Returns them in createdAt order; the caller is responsible for
   * marking returned messages as processed so they don't render as
   * separate top-level groups.
   */
  collectFlatTaskCompletions(allToolMessages: Message[], allMessages: Message[]): Message[] {
    const completions: Message[] = [];
    for (const toolMsg of allToolMessages) {
      const children = allMessages.filter((m) => m.parentId === toolMsg.id);
      for (const child of children) {
        if (!isTaskCompletionSignal(getMessageSignal(child))) continue;
        completions.push(child);
      }
    }
    completions.sort((a, b) => a.createdAt - b.createdAt);
    return completions;
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

        // Gather callback-typed signal toolless siblings among this
        // tool's children. `getMessageSignal` already returns undefined
        // for tool-using assistants and non-assistants; `task-completion`
        // turns are excluded here so they render outside the accordion
        // (see `collectTaskCompletions`).
        const callbacks: Message[] = [];
        for (const toolChild of child.children) {
          const toolChildMsg = this.messageMap.get(toolChild.id);
          if (!toolChildMsg) continue;
          if (!isCallbackSignal(getMessageSignal(toolChildMsg))) continue;
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
   * Collect post-task-summary toolless siblings (LOBE-8998) — assistants
   * tagged with `metadata.signal.type === 'task-completion'`, fired by
   * the LLM after CC delivers `system task_notification` for a long-
   * running tool (Monitor, etc.). Each one belongs inside the same
   * AssistantGroup as the preceding SignalCallbacks block, rendered as
   * a plain message AFTER the accordion.
   *
   * Walks the same main-chain as `collectAssistantGroupMessages` so the
   * lookup tracks signal-tagged toolless siblings exactly where they
   * live in the parentId tree (children of the source tool's
   * tool_result, alongside the callbacks).
   *
   * Returned in creation order. Multiple completions per group are rare
   * but supported (e.g. two long-running tools both summarized in one
   * LLM call).
   */
  collectTaskCompletions(message: Message, idNode: IdNode): MessageNode[] {
    const groupAgentId = message.agentId;
    const nodes: MessageNode[] = [];
    const visited = new Set<string>();

    const walk = (node: IdNode): void => {
      if (visited.has(node.id)) return;
      visited.add(node.id);

      for (const child of node.children) {
        const childMsg = this.messageMap.get(child.id);
        if (childMsg?.role !== 'tool') continue;

        for (const toolChild of child.children) {
          const toolChildMsg = this.messageMap.get(toolChild.id);
          if (!toolChildMsg) continue;
          if (toolChildMsg.agentId !== groupAgentId) continue;
          if (!isTaskCompletionSignal(getMessageSignal(toolChildMsg))) continue;
          nodes.push({ id: toolChildMsg.id, type: 'message' });
        }

        // Continue walking the main chain into the next non-signal
        // follower under this tool (same skip rule as
        // `collectAssistantGroupMessages`).
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
    return nodes;
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

      // Pick the next main-chain assistant under this tool. Mirror the
      // skip rule used by `collectAssistantGroupMessages`: signal-tagged
      // toolless siblings (Monitor callbacks etc., LOBE-8998) share the
      // parent tool but live on a side-channel — if they appear before
      // the real follower, blindly taking children[0] would end the
      // walk on a callback node and truncate the AssistantGroup tail.
      for (const nextChild of toolNode.children) {
        const nextMsg = this.messageMap.get(nextChild.id);
        if (nextMsg?.role !== 'assistant') continue;
        if (nextMsg.agentId !== groupAgentId) continue;
        if (getMessageSignal(nextMsg)) continue;
        return this.findLastNodeInAssistantGroup(nextChild, groupAgentId);
      }
    }

    // No more assistant messages from the same agent, return the last tool node
    return toolChildren.at(-1) ?? null;
  }
}
