import type { ContextNode, IdNode, Message, MessageNode, SignalCallbacksNode } from '../types';
import { BranchResolver } from './BranchResolver';

/**
 * Persisted external-signal lineage on `message.metadata.signal` —
 * mirrors `MessageSignal` in `@lobechat/types/message/common/metadata.ts`.
 * Locally duplicated to avoid a cross-package import for a single
 * structural type.
 *
 * Phase 2 () promotes this to a dedicated `messages.signal`
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
 * Phase 2 compat seam (): when the `messages.signal` column
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
    // BranchResolver is stateless; default keeps existing 2-arg call sites working.
    private branchResolver: BranchResolver = new BranchResolver(),
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
    const tools = assistant.tools || [];
    if (tools.length === 0) return [];

    const toolMessagesById = new Map(
      messages.filter((m) => m.role === 'tool').map((m) => [m.id, m]),
    );
    const collected: Message[] = [];
    const collectedIds = new Set<string>();

    for (const tool of tools) {
      const explicitResultId = tool.result_msg_id;
      const explicitToolMessage = explicitResultId
        ? toolMessagesById.get(explicitResultId)
        : undefined;

      if (explicitToolMessage) {
        if (!collectedIds.has(explicitToolMessage.id)) {
          collected.push(explicitToolMessage);
          collectedIds.add(explicitToolMessage.id);
        }
        continue;
      }

      const fallbackToolMessage = messages.find(
        (m) => m.role === 'tool' && m.parentId === assistant.id && m.tool_call_id === tool.id,
      );

      if (fallbackToolMessage && !collectedIds.has(fallbackToolMessage.id)) {
        collected.push(fallbackToolMessage);
        collectedIds.add(fallbackToolMessage.id);
      }
    }

    return collected;
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

    // Mark visited up front so duplicated tool_call_ids (the same tool result
    // reachable from multiple assistants) can't recurse forever.
    processedIds.add(currentAssistant.id);

    // Add current assistant to chain
    assistantChain.push(currentAssistant);

    // Get the agentId of the first assistant in the chain (the group owner)
    const groupAgentId = assistantChain[0].agentId;

    // Collect its tool messages
    const toolMessages = this.collectToolMessages(currentAssistant, allMessages);
    allToolMessages.push(...toolMessages);

    // Find the next step's assistant. Role-aware dual-form walk (LOBE-10445):
    // the continuation may hang off this assistant directly (assistant-anchored
    // / new form) OR off one of its tool results (tool-anchored / old form).
    const continuation = this.findFlatChainContinuation(
      currentAssistant,
      toolMessages,
      allMessages,
      processedIds,
      groupAgentId,
    );
    if (!continuation) return;

    if (continuation.tools && continuation.tools.length > 0) {
      // Continue the chain (recursion marks it processed at the top)
      this.collectAssistantChain(
        continuation,
        allMessages,
        assistantChain,
        allToolMessages,
        processedIds,
      );
    } else {
      // Final assistant without tools — caller marks the whole chain processed
      assistantChain.push(continuation);
    }
  }

  /**
   * Find the next assistant in a tool-using step's chain (flat variant).
   *
   * Dual-form aware: candidates are gathered from BOTH the assistant's own
   * non-tool children (new assistant-anchored form, where the next assistant is
   * a sibling of the tool results) AND each tool result's children (old
   * tool-anchored form).
   *
   * Two guards keep the assistant-anchored candidate honest:
   * - **Fan-out guard**: if any tool hosts an AgentCouncil or spawned async
   *   tasks, the chain does NOT continue linearly through this step — neither
   *   through that tool's children nor through an assistant-anchored follow-up
   *   (a post-task summary whose `parentId === currentAssistant.id`). Those are
   *   emitted by the council/tasks flow AFTER the group, so the assistant seed
   *   is dropped and the chain ends here.
   * - **Branch resolution**: when >1 non-tool same-agent continuations share a
   *   parent (e.g. a regenerated continuation), pick the active one via
   *   `activeBranchIndex` instead of blindly taking the earliest.
   */
  private findFlatChainContinuation(
    currentAssistant: Message,
    toolMessages: Message[],
    allMessages: Message[],
    processedIds: Set<string>,
    groupAgentId: string | undefined,
  ): Message | undefined {
    const candidateParentIds = new Set<string>();
    let hasFanOutTool = false;
    for (const toolMsg of toolMessages) {
      const isCouncil = (toolMsg.metadata as any)?.agentCouncil === true;
      const toolChildren = allMessages.filter((m) => m.parentId === toolMsg.id);
      const hasTaskChild = toolChildren.some((m) => m.role === 'task');
      if (isCouncil || hasTaskChild) {
        hasFanOutTool = true;
        continue;
      }
      candidateParentIds.add(toolMsg.id);
    }
    // Assistant-anchored continuation only counts when this step did not fan out.
    if (!hasFanOutTool) candidateParentIds.add(currentAssistant.id);

    const candidates = allMessages
      .filter((m) => m.parentId != null && candidateParentIds.has(m.parentId))
      .filter((m) => m.role !== 'tool' && !processedIds.has(m.id))
      .filter((m) => m.role === 'assistant' && m.agentId === groupAgentId && !getMessageSignal(m))
      .sort((a, b) => a.createdAt - b.createdAt);

    const activeId = this.resolveActiveContinuationId(candidates);
    return activeId ? candidates.find((m) => m.id === activeId) : undefined;
  }

  /**
   * Pick the active continuation among same-step candidates (sorted by
   * createdAt). One candidate ⇒ a linear continuation. >1 non-tool siblings
   * under a single parent ⇒ a branch (e.g. a regenerated continuation), so
   * consult the parent's `activeBranchIndex` via BranchResolver instead of
   * blindly taking the earliest — otherwise the inactive branch is silently
   * chosen and the active one dropped. Returns undefined when there is no
   * continuation, or the active branch is an optimistic not-yet-created one.
   */
  private resolveActiveContinuationId(sortedCandidates: Message[]): string | undefined {
    if (sortedCandidates.length === 0) return undefined;
    const earliest = sortedCandidates[0];
    const parentId = earliest.parentId;
    if (parentId == null) return earliest.id;

    // Branch siblings share one parent; only those under the earliest
    // candidate's parent participate in this branch decision. Use childrenMap
    // (creation) order so it lines up with how activeBranchIndex is assigned.
    const eligibleIds = new Set(sortedCandidates.map((m) => m.id));
    const siblingIds = (this.childrenMap.get(parentId) ?? []).filter((id) => eligibleIds.has(id));
    if (siblingIds.length <= 1) return earliest.id;

    const parentMsg = this.messageMap.get(parentId);
    if (!parentMsg) return earliest.id;

    return this.branchResolver.getActiveBranchIdFromMetadata(
      parentMsg,
      siblingIds,
      this.childrenMap,
    );
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
   * Flat-list variant — find post-task-summary assistants (),
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

    // Find the next step's assistant (dual-form aware, see findChainContinuationNode)
    const nextNode = this.findChainContinuationNode(idNode, agentId);
    if (nextNode) {
      const nextMsg = this.messageMap.get(nextNode.id)!;
      this.collectAssistantGroupMessages(nextMsg, nextNode, children, agentId);
    }
  }

  /**
   * Find the IdNode of the next assistant in a tool-using step's chain
   * (contextTree variant of {@link findFlatChainContinuation}). Same fan-out
   * guard (AgentCouncil / async tasks end the chain — including any
   * assistant-anchored post-task summary) and branch resolution (>1 non-tool
   * siblings under one parent ⇒ pick the active branch) as the flat variant.
   * Signal-tagged toolless siblings (Monitor callbacks etc.) are skipped so the
   * main chain walks the real follower.
   */
  private findChainContinuationNode(idNode: IdNode, groupAgentId?: string): IdNode | undefined {
    const candidateNodes: IdNode[] = [];
    let hasFanOutTool = false;

    // (b) each tool result's children (old form); detect fan-out tools
    for (const toolNode of idNode.children) {
      const toolMsg = this.messageMap.get(toolNode.id);
      if (toolMsg?.role !== 'tool') continue;
      const isCouncil = (toolMsg.metadata as any)?.agentCouncil === true;
      const hasTaskChild = toolNode.children.some(
        (child) => this.messageMap.get(child.id)?.role === 'task',
      );
      if (isCouncil || hasTaskChild) {
        hasFanOutTool = true;
        continue;
      }
      candidateNodes.push(...toolNode.children);
    }

    // (a) the assistant's own non-tool children (new form) — only when the step
    // did not fan out (otherwise they are post-fan-out summaries, not inline)
    if (!hasFanOutTool) {
      for (const child of idNode.children) {
        if (this.messageMap.get(child.id)?.role === 'tool') continue;
        candidateNodes.push(child);
      }
    }

    const eligible = candidateNodes
      .map((node) => ({ msg: this.messageMap.get(node.id), node }))
      .filter(
        (c) =>
          c.msg?.role === 'assistant' && c.msg.agentId === groupAgentId && !getMessageSignal(c.msg),
      )
      .sort((a, b) => a.msg!.createdAt - b.msg!.createdAt);

    const activeId = this.resolveActiveContinuationId(eligible.map((c) => c.msg!));
    return activeId ? eligible.find((c) => c.node.id === activeId)?.node : undefined;
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
   * Collect post-task-summary toolless siblings () — assistants
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
    // Walk the chain to its next step (dual-form aware, see findChainContinuationNode)
    const nextNode = this.findChainContinuationNode(idNode, groupAgentId);
    if (nextNode) {
      return this.findLastNodeInAssistantGroup(nextNode, groupAgentId);
    }

    // No further same-agent assistant. If this step still owns tool results
    // (e.g. the last tool hosts an AgentCouncil / tasks), return the last tool
    // node so findNextAfterTools can inspect it; otherwise this node is the tail.
    const toolChildren = idNode.children.filter(
      (child) => this.messageMap.get(child.id)?.role === 'tool',
    );
    if (toolChildren.length === 0) {
      return idNode;
    }
    return toolChildren.at(-1) ?? null;
  }
}
