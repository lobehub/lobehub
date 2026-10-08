import { isInThreadScope } from '../indexing';
import type {
  ContextNode,
  IdNode,
  Message,
  MessageNode,
  SignalCallbacksNode,
  ThreadScope,
} from '../types';
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
 * Read the external-signal lineage from a message. `signal` is trigger
 * provenance — the writer attaches it at stream_start, before it knows what the
 * turn will output — so the collector defangs the two cases where a woken turn
 * is really back on the MAIN CHAIN and must render as a normal step:
 *
 * - it emitted TOOLS (the LLM kept working), recognised structurally here; or
 * - the writer flagged it `signalPromoted` — its persisted verdict that the turn
 *   delivered an ANSWER, not a one-line reactive note (set at flush time, where
 *   the writer holds the prose; see `turnPromotionMetadata`). The classification
 *   is NOT re-derived from content here — the writer settles it once, and this
 *   reads the marker, so the read side and the spine query cannot drift. A
 *   promoted turn is also persisted LINEARLY (the writer advances the spine onto
 *   it), so it never competes with the real continuation as a fork.
 *
 * A toolless, unpromoted signal turn stays a callback and renders in the
 * SignalCallbacks accordion — which is what the accordion is for.
 *
 * The tag is read FIRST and short-circuits: this runs in the chain-walk's
 * per-step candidate filter, so for a topic with no signals it must stay a
 * property read — the checks below only matter for a tagged message.
 *
 * Phase 2 compat seam (): when the `messages.signal` column
 * lands, prefer it over `metadata.signal`.
 */
const getMessageSignal = (msg: Message): MessageSignal | undefined => {
  if (msg.role !== 'assistant') return undefined;
  const meta = msg.metadata as
    { signal?: MessageSignal; signalPromoted?: boolean } | undefined | null;
  const signal = meta?.signal;
  if (!signal) return undefined;
  if (meta.signalPromoted) return undefined;
  if (msg.tools && msg.tools.length > 0) return undefined;
  return signal;
};

/** `tool-stdout` / `tool-callback` — reactive callback turns rendered inside the SignalCallbacks accordion. */
const isCallbackSignal = (sig: MessageSignal | undefined): boolean =>
  sig?.type === 'tool-stdout' || sig?.type === 'tool-callback';

/** `task-completion` — post-task summary, rendered as a plain message AFTER the SignalCallbacks block. */
const isTaskCompletionSignal = (sig: MessageSignal | undefined): boolean =>
  sig?.type === 'task-completion';

/** Lookups over one message array, each list in that array's order. */
interface MessageArrayIndex {
  /** Keyed by the raw `parentId` (not `childrenMap`, which remaps orphans and compressed groups). */
  childrenByParentId: Map<string, Message[]>;
  position: Map<string, number>;
  toolById: Map<string, Message>;
}

const EMPTY_MESSAGES: readonly Message[] = [];

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
    private branchResolver: BranchResolver = new BranchResolver(messageMap),
    /** See `ThreadScope`. Defaults to every message in scope. */
    private threadScope: ThreadScope = undefined,
  ) {}

  private scopedMessagesCache?: Message[];

  /**
   * Message arrays handed to the collector are never mutated during a parse, so
   * index each once. Rescanning the whole array per chain step made parse
   * quadratic: a 2,883-message agent topic took 30x longer than with these indexes.
   */
  private readonly arrayIndexes = new WeakMap<readonly Message[], MessageArrayIndex>();

  /**
   * Every message the current scope may walk.
   *
   * Chain classification has to see exactly what chain collection will be given: if a
   * threaded reply counts as the continuation that makes an assistant a tool-chain head,
   * but collection then cannot reach it, the assistant renders as an empty one-message
   * group instead of its own bubble.
   */
  private scopedMessages(): Message[] {
    this.scopedMessagesCache ??= [...this.messageMap.values()].filter(
      (message) => this.threadScope === undefined || isInThreadScope(message, this.threadScope),
    );
    return this.scopedMessagesCache;
  }

  private messageIndex(messages: readonly Message[]): MessageArrayIndex {
    const cached = this.arrayIndexes.get(messages);
    if (cached) return cached;

    const index: MessageArrayIndex = {
      childrenByParentId: new Map(),
      position: new Map(),
      toolById: new Map(),
    };
    messages.forEach((message, i) => {
      index.position.set(message.id, i);
      if (message.role === 'tool') index.toolById.set(message.id, message);
      if (message.parentId == null) return;

      const siblings = index.childrenByParentId.get(message.parentId);
      if (siblings) siblings.push(message);
      else index.childrenByParentId.set(message.parentId, [message]);
    });
    this.arrayIndexes.set(messages, index);
    return index;
  }

  private childrenOf(messages: readonly Message[], parentId: string): readonly Message[] {
    return this.messageIndex(messages).childrenByParentId.get(parentId) ?? EMPTY_MESSAGES;
  }

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

    const toolMessagesById = this.messageIndex(messages).toolById;
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

      const fallbackToolMessage = this.childrenOf(messages, assistant.id).find(
        (m) => m.role === 'tool' && m.tool_call_id === tool.id,
      );

      if (fallbackToolMessage && !collectedIds.has(fallbackToolMessage.id)) {
        collected.push(fallbackToolMessage);
        collectedIds.add(fallbackToolMessage.id);
      }
    }

    return collected;
  }

  /**
   * True when a TOOLLESS assistant is the head of a turn that eventually reaches
   * a tool-using step — the narration the LLM streams in reply to the user
   * before its first tool call. `collectAssistantChain` already walks correctly
   * from such a head, but the flat-list dispatcher only opens an AssistantGroup
   * when the message itself carries tools — so without this check the toolless
   * head is emitted as its own standalone bubble and visually splits off from the
   * group that starts at the first tool step (looks like a broken chain).
   *
   * Deliberately narrow:
   * - Only a turn head (parent is a `user` message). A toolless step wedged
   *   mid-chain (between two tool steps) is bridged by `collectAssistantChain`
   *   itself so the chain stays in one group — see the toolless-continuation
   *   branch there; it must NOT also be opened as a head here or the same run
   *   would split.
   * - The continuation path must eventually carry tools. Consecutive toolless
   *   prose steps are still part of the same hetero-agent run, so walk through
   *   them instead of splitting the visible chain into standalone bubbles.
   * - A fork (>1 same-agent non-signal continuation) returns false so branch
   *   handling stays untouched.
   */
  isToolChainHead(assistant: Message): boolean {
    if (assistant.role !== 'assistant') return false;
    if (assistant.tools && assistant.tools.length > 0) return false;

    const parent = assistant.parentId ? this.messageMap.get(assistant.parentId) : undefined;
    if (parent?.role !== 'user') return false;

    const groupAgentId = assistant.agentId;
    const allMessages = this.scopedMessages();
    const visited = new Set<string>([assistant.id]);
    let current: Message = assistant;

    while (true) {
      const next = this.findFlatChainContinuation(current, [], allMessages, visited, groupAgentId);
      if (!next) return false;
      if (next.tools && next.tools.length > 0) return true;

      visited.add(next.id);
      current = next;
    }
  }

  /**
   * Collect the entire assistant chain
   * (assistant -> tools -> assistant -> tools -> ...)
   * Only collects messages from the SAME agent (matching agentId)
   *
   * Walked iteratively: a long run is one chain thousands of steps deep.
   */
  collectAssistantChain(
    currentAssistant: Message,
    allMessages: Message[],
    assistantChain: Message[],
    allToolMessages: Message[],
    processedIds: Set<string>,
  ): void {
    let current: Message | undefined = currentAssistant;
    while (current) {
      current = this.collectAssistantChainStep(
        current,
        allMessages,
        assistantChain,
        allToolMessages,
        processedIds,
      );
    }
  }

  /**
   * Append one tool-using step (plus any toolless steps after it) to the chain
   * and return the next tool-using assistant to continue with.
   */
  private collectAssistantChainStep(
    currentAssistant: Message,
    allMessages: Message[],
    assistantChain: Message[],
    allToolMessages: Message[],
    processedIds: Set<string>,
  ): Message | undefined {
    if (processedIds.has(currentAssistant.id)) return;

    // Mark visited up front so duplicated tool_call_ids (the same tool result
    // reachable from multiple assistants) can't loop forever.
    processedIds.add(currentAssistant.id);

    // Add current assistant to chain
    assistantChain.push(currentAssistant);

    // Get the agentId of the first assistant in the chain (the group owner)
    const groupAgentId = assistantChain[0].agentId;

    // Collect its tool messages
    const toolMessages = this.collectToolMessages(currentAssistant, allMessages);
    allToolMessages.push(...toolMessages);

    // Find the next step's assistant. Role-aware dual-form walk:
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

    // Continue the chain (the next step marks it processed at the top)
    if (continuation.tools && continuation.tools.length > 0) return continuation;

    // Toolless continuations are still part of the same hetero-agent run. The
    // model can emit several prose-only progress updates before the next tool
    // call, so keep walking until the chain either ends in a toolless final
    // answer or reaches the next tool-using assistant.
    let toollessContinuation: Message | undefined = continuation;
    while (
      toollessContinuation &&
      (!toollessContinuation.tools || toollessContinuation.tools.length === 0)
    ) {
      assistantChain.push(toollessContinuation);
      processedIds.add(toollessContinuation.id);

      toollessContinuation = this.findFlatChainContinuation(
        toollessContinuation,
        [], // a toolless step owns no tool results
        allMessages,
        processedIds,
        groupAgentId,
      );
    }

    return toollessContinuation;
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
   * - **Branch resolution**: when >1 non-tool same-agent continuations compete,
   *   first resolve the active direct child of this assistant (including
   *   continuations under different tool results), then resolve regenerated
   *   siblings under that child.
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
      const hasTaskChild = this.childrenOf(allMessages, toolMsg.id).some((m) => m.role === 'task');
      if (isCouncil || hasTaskChild) {
        hasFanOutTool = true;
        continue;
      }
      candidateParentIds.add(toolMsg.id);
    }
    // Assistant-anchored continuation only counts when this step did not fan out.
    if (!hasFanOutTool) candidateParentIds.add(currentAssistant.id);

    // Equal timestamps fall back to array order, as a stable sort of the
    // whole array did before the index.
    const { position } = this.messageIndex(allMessages);
    const candidates = [...candidateParentIds]
      .flatMap((parentId) => this.childrenOf(allMessages, parentId))
      .filter((m) => m.role !== 'tool' && !processedIds.has(m.id))
      .filter((m) => m.role === 'assistant' && m.agentId === groupAgentId && !getMessageSignal(m))
      .sort((a, b) => a.createdAt - b.createdAt || position.get(a.id)! - position.get(b.id)!);

    const activeId = this.resolveActiveContinuationId(candidates, currentAssistant);
    if (!activeId) {
      this.markUnselectedContinuations(undefined, candidates, processedIds);
      return;
    }

    const activeContinuation = candidates.find((message) => message.id === activeId);
    if (!activeContinuation) {
      this.markUnselectedContinuations(undefined, candidates, processedIds);
      return;
    }

    this.markUnselectedContinuations(activeContinuation.id, candidates, processedIds);
    return activeContinuation;
  }

  /**
   * Multiple assistant continuations can share one parent or compete across
   * parallel tool-result parents. Once BranchResolver selects the continuation
   * for the current chain, every other same-step candidate must be consumed;
   * otherwise FlatListBuilder's post-group continuation drain emits them later
   * as standalone messages and leaks an inactive assistant branch into the next
   * model request.
   */
  private markUnselectedContinuations(
    activeContinuationId: string | undefined,
    candidates: Message[],
    processedIds: Set<string>,
  ): void {
    for (const candidate of candidates) {
      if (candidate.id !== activeContinuationId) {
        processedIds.add(candidate.id);
      }
    }
  }

  /**
   * Pick the active continuation among same-step candidates (sorted by
   * createdAt). Parallel tool results can each own a continuation, so resolve
   * the active direct child of the assistant before handling regenerated
   * siblings under one parent. Without the first step, an earlier stale tool
   * continuation wins before BranchResolver can see the latest user descendant.
   */
  private resolveActiveContinuationId(
    sortedCandidates: Message[],
    branchOwner?: Message,
  ): string | undefined {
    if (sortedCandidates.length === 0) return undefined;

    let candidates = sortedCandidates;
    if (branchOwner && candidates.length > 1) {
      const directChildIds = this.childrenMap.get(branchOwner.id) ?? [];
      const directChildIdSet = new Set(directChildIds);
      const candidateBranchIds = new Set(
        candidates
          .map((candidate) =>
            candidate.parentId === branchOwner.id ? candidate.id : candidate.parentId,
          )
          .filter((id): id is string => Boolean(id && directChildIdSet.has(id))),
      );

      if (candidateBranchIds.size > 1) {
        const orderedCandidateBranchIds = directChildIds.filter((id) => candidateBranchIds.has(id));
        const activeBranchId = this.branchResolver.getActiveBranchIdFromMetadata(
          branchOwner,
          orderedCandidateBranchIds,
          this.childrenMap,
          this.branchResolver.getMetadataBranchIds(directChildIds),
        );
        if (!activeBranchId) return undefined;

        candidates = candidates.filter(
          (candidate) => candidate.id === activeBranchId || candidate.parentId === activeBranchId,
        );
        if (candidates.length === 0) return undefined;
      }
    }

    const earliest = candidates[0];
    const parentId = earliest.parentId;
    if (parentId == null) return earliest.id;

    // Branch siblings share one parent; only those under the earliest
    // candidate's parent participate in this branch decision. Use childrenMap
    // (creation) order so it lines up with how activeBranchIndex is assigned.
    const eligibleIds = new Set(candidates.map((m) => m.id));
    const directSiblingIds = this.childrenMap.get(parentId) ?? [];
    const siblingIds = directSiblingIds.filter((id) => eligibleIds.has(id));
    if (siblingIds.length <= 1) return earliest.id;

    const parentMsg = this.messageMap.get(parentId);
    if (!parentMsg) return earliest.id;

    return this.branchResolver.getActiveBranchIdFromMetadata(
      parentMsg,
      siblingIds,
      this.childrenMap,
      this.branchResolver.getMetadataBranchIds(directSiblingIds),
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
      const children = this.childrenOf(allMessages, toolMsg.id);
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
      const children = this.childrenOf(allMessages, toolMsg.id);
      for (const child of children) {
        if (!isTaskCompletionSignal(getMessageSignal(child))) continue;
        completions.push(child);
      }
    }
    completions.sort((a, b) => a.createdAt - b.createdAt);
    return completions;
  }

  /**
   * Collect assistant messages for an AssistantGroup (contextTree version)
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

    // Walked iteratively: a group's chain can be thousands of steps long.
    let currentMessage: Message | undefined = message;
    let currentNode: IdNode | undefined = idNode;
    while (currentMessage && currentNode) {
      currentNode = this.collectAssistantGroupStep(currentMessage, currentNode, children, agentId);
      currentMessage = currentNode ? this.messageMap.get(currentNode.id) : undefined;
    }
  }

  /**
   * Append one assistant step to the group and return the next step's IdNode.
   */
  private collectAssistantGroupStep(
    message: Message,
    idNode: IdNode,
    children: ContextNode[],
    agentId: string | undefined,
  ): IdNode | undefined {
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
    return this.findChainContinuationNode(idNode, agentId);
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

    const activeId = this.resolveActiveContinuationId(
      eligible.map((c) => c.msg!),
      this.messageMap.get(idNode.id),
    );
    return activeId ? eligible.find((c) => c.node.id === activeId)?.node : undefined;
  }

  /**
   * Visit, in order, every tool result along a group's main chain: each tool
   * child of a step, then the steps under its first same-agent, non-signal
   * follower before the next sibling tool. Walked with an explicit stack: one
   * agent run can chain thousands of steps.
   */
  private forEachMainChainTool(
    idNode: IdNode,
    groupAgentId: string | undefined,
    visit: (toolNode: IdNode) => void,
  ): void {
    const visited = new Set<string>();
    // Each frame resumes a step's children where its last descent left off.
    const stack: { children: IdNode[]; index: number }[] = [];
    const enter = (node: IdNode) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      stack.push({ children: node.children, index: 0 });
    };

    enter(idNode);
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      if (frame.index >= frame.children.length) {
        stack.pop();
        continue;
      }

      const child = frame.children[frame.index++];
      if (this.messageMap.get(child.id)?.role !== 'tool') continue;

      visit(child);
      const follower = child.children.find((next) => {
        const nextMsg = this.messageMap.get(next.id);
        return (
          nextMsg?.role === 'assistant' &&
          nextMsg.agentId === groupAgentId &&
          !getMessageSignal(nextMsg)
        );
      });
      if (follower) enter(follower);
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
    this.forEachMainChainTool(idNode, groupAgentId, (child) => {
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
    });
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
    this.forEachMainChainTool(idNode, groupAgentId, (child) => {
      for (const toolChild of child.children) {
        const toolChildMsg = this.messageMap.get(toolChild.id);
        if (!toolChildMsg) continue;
        if (toolChildMsg.agentId !== groupAgentId) continue;
        if (!isTaskCompletionSignal(getMessageSignal(toolChildMsg))) continue;
        nodes.push({ id: toolChildMsg.id, type: 'message' });
      }
    });
    return nodes;
  }

  /**
   * Find next message after tools in an assistant group
   */
  findNextAfterTools(assistantMsg: Message, idNode: IdNode): IdNode | null {
    const lastAssistantNode = this.findLastAssistantNodeInGroup(idNode, assistantMsg.agentId);
    const nextNode = this.resolveAssistantGroupTailChild(lastAssistantNode);
    if (!nextNode) return null;

    const nextMessage = this.messageMap.get(nextNode.id);
    if (nextMessage?.role !== 'tool') return nextNode;

    // Check if the selected tool has agentCouncil mode
    // In this case, return the tool node itself so ContextTreeBuilder can process it
    if ((nextMessage.metadata as any)?.agentCouncil === true) {
      return nextNode;
    }

    // Check if the selected tool has ANY task children
    // In this case, return the tool node itself so ContextTreeBuilder can process tasks
    const taskChildren = nextNode.children.filter((child) => {
      const childMessage = this.messageMap.get(child.id);
      return childMessage?.role === 'task';
    });
    if (taskChildren.length > 0) {
      return nextNode;
    }

    return nextNode.children[0] ?? null;
  }

  /**
   * Return the final same-agent assistant that belongs inside this group. The
   * child selected after that assistant can be either a tool-hosted legacy
   * continuation or a direct non-tool continuation in the current storage form.
   */
  private findLastAssistantNodeInGroup(idNode: IdNode, groupAgentId?: string): IdNode {
    // Iterative: a group's chain can be thousands of steps long.
    let current = idNode;
    let nextNode = this.findChainContinuationNode(current, groupAgentId);
    while (nextNode) {
      current = nextNode;
      nextNode = this.findChainContinuationNode(current, groupAgentId);
    }
    return current;
  }

  /**
   * Resolve the first node after an AssistantGroup without applying
   * `activeBranchIndex` to tool children. Persisted branch indexes count only
   * non-tool direct children; latest-user inference may still select a legacy
   * continuation hosted below a tool result when no explicit branch is active.
   */
  private resolveAssistantGroupTailChild(idNode: IdNode): IdNode | undefined {
    const message = this.messageMap.get(idNode.id);
    if (!message) return idNode.children.at(-1);

    const childIds = idNode.children.map((child) => child.id);
    const activeBranchId = this.branchResolver.getActiveBranchIdFromMetadata(
      message,
      childIds,
      this.childrenMap,
      this.branchResolver.getMetadataBranchIds(childIds),
    );

    return idNode.children.find((child) => child.id === activeBranchId);
  }
}
