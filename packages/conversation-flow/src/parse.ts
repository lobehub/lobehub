import { buildHelperMaps } from './indexing';
import { buildIdTree } from './structuring';
import { Transformer } from './transformation';
import type { Message, MessageGroupMetadata, ParseResult } from './types';

/**
 * Main parse function - the brain of the conversation flow engine
 *
 * Converts a flat array of messages into:
 * 1. messageMap - for O(1) message access
 * 2. displayTree - semantic tree structure for navigation
 * 3. flatList - flattened array optimized for virtual list rendering
 *
 * Uses a three-phase parsing strategy:
 * 1. Indexing - build helper maps for efficient querying
 * 2. Structuring - convert flat data to tree structure
 * 3. Transformation - apply business logic to create semantic nodes and flat list
 *
 * @param messages - Flat array of messages from backend
 * @param messageGroups - Optional array of message group metadata for compare/manual grouping
 * @returns ParseResult containing messageMap, displayTree, and flatList
 */
export function parse(messages: Message[], messageGroups?: MessageGroupMetadata[]): ParseResult {
  // Pre-processing: Transform sub_agent messages before building helper maps
  // This ensures FlatListBuilder and MessageCollector see the correct agentId
  // and won't merge messages from different agents into the same group
  // Only applies to scope: 'sub_agent' (agent-to-agent calls, not group orchestration)
  const processedMessages = messages.map((msg) => {
    if (msg.metadata?.scope === 'sub_agent' && msg.metadata?.subAgentId) {
      return { ...msg, agentId: msg.metadata.subAgentId };
    }
    return msg;
  });

  // Phase 1: Indexing
  // Build helper maps for O(1) access patterns
  const helperMaps = buildHelperMaps(processedMessages, messageGroups);

  // Phase 2: Structuring
  // Convert flat parent-child relationships to tree structure
  // Separates main flow from threaded conversations
  const idTree = buildIdTree(helperMaps);

  // Phase 3: Transformation
  // Apply priority-based pattern matching to create semantic display nodes
  const transformer = new Transformer(helperMaps);
  const contextTree = transformer.transformAll(idTree);

  // Phase 3b: Generate flatList for virtual list rendering
  // Implements RFC priority-based pattern matching
  const flatList = transformer.flatten(processedMessages);

  // Convert messageMap from Map to plain object for serialization
  // Clean up metadata for assistant messages with tools
  const messageMapObj: Record<string, Message> = {};
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
    'inputVideoTokens',
    'inputToolTokens',
    'inputWriteCacheTokens',
    'latency',
    'outputAudioTokens',
    'outputImageTokens',
    'outputReasoningTokens',
    'outputTextTokens',
    // Nested canonical shape — executors write `metadata.usage` / `metadata.performance`
    // as objects; treat them as part of the usage/performance set alongside the legacy flat keys.
    'performance',
    'rejectedPredictionTokens',
    'totalInputTokens',
    'totalOutputTokens',
    'totalTokens',
    'tps',
    'ttft',
    'usage',
  ]);

  helperMaps.messageMap.forEach((message, id) => {
    let processedMessage = message;

    // Transform supervisor messages: convert role from 'assistant' to 'supervisor'
    // This enables UI to render supervisor messages differently from regular assistant messages
    // Note: context-engine has SupervisorRoleRestoreProcessor to restore role='assistant' before model API call
    if (message.role === 'assistant' && message.metadata?.isSupervisor) {
      processedMessage = { ...message, role: 'supervisor' as const };
    }

    // Note: sub_agent scope transformation is done in pre-processing phase (before buildHelperMaps)
    // No need to transform agentId here since it's already been transformed

    // For assistant messages with tools, clean metadata to keep only usage/performance fields
    if (
      processedMessage.role === 'assistant' &&
      processedMessage.tools &&
      processedMessage.tools.length > 0 &&
      processedMessage.metadata
    ) {
      const cleanedMetadata: Record<string, any> = {};
      Object.entries(processedMessage.metadata).forEach(([key, value]) => {
        if (usagePerformanceFields.has(key)) {
          cleanedMetadata[key] = value;
        }
      });
      messageMapObj[id] = {
        ...processedMessage,
        metadata: Object.keys(cleanedMetadata).length > 0 ? cleanedMetadata : undefined,
      };
    } else {
      messageMapObj[id] = processedMessage;
    }
  });

  // Transform supervisor messages in flatList
  // For non-grouped supervisor messages (e.g., supervisor summary without tools)
  // Note: sub_agent scope transformation is done in pre-processing phase (before buildHelperMaps)
  const processedFlatList = flatList.map((msg) => {
    let next = msg;

    // Transform supervisor messages
    if (next.role === 'assistant' && next.metadata?.isSupervisor) {
      next = { ...next, role: 'supervisor' as const };
    }

    // Promote `metadata.usage` (canonical storage) onto the top-level `usage`
    // field that UIChatMessage consumers (Extras token badge, tokenCounter,
    // etc.) read from. The DB layer stores token usage inside the metadata
    // JSONB column — executors on every path (Gateway, hetero-agent CLI) write
    // there — but no server-side transform lifts it out. Doing it here keeps
    // the promotion in one place, close to where display shapes are built,
    // and works for both desktop (local PGlite) and web (remote Postgres).
    if (!next.usage && next.metadata?.usage) {
      next = { ...next, usage: next.metadata.usage };
    }

    return next;
  });

  // Two shapes sit as sibling branches under the same assistant tool-use shell
  // and lose branch resolution to the continuation the conversation actually
  // took. Normal branch resolution must keep choosing ONE continuation, so
  // neither is fixed by changing which branch wins — they are recovered into
  // the render list instead, at their own timestamps. Their descendants are
  // deliberately not pulled across: those may contradict the active
  // continuation.
  //
  //  - A taskCallback next to a tool result. Hiding the inactive callback also
  //    hides the only user-visible record that a task finished.
  //  - A group member's reply. `speak` parents the member's answer to the
  //    SUPERVISOR's tool-use message, not to the tool result, so the member
  //    reply and the tool result are siblings and the supervisor continues
  //    through the tool result. The member is not a competing answer to the
  //    same turn — it is a different participant in the same conversation —
  //    but branch resolution has no way to tell, so the reply vanished from
  //    the transcript while remaining in messageMap (#19552).
  // Everything the transcript already shows, at any depth and whatever shape it
  // is shown in. A group carries messages INSIDE the supervisor's bubble: a
  // council block keeps whole members, while `children`, `taskCompletions` and
  // `signalCallbacks[].callbacks` denormalize a message down to a block that
  // keeps the source id and drops the role. Reading only the top level appended
  // every broadcast answer a second time; reading only the things that still
  // carry a role missed every folded one (#19566). Naming the folding fields
  // instead is a list that goes stale, so this takes any id it finds: the ids
  // that belong to something other than a message — files, chunks, tool calls,
  // the sender — come from their own tables and cannot collide with one.
  const collectRenderedIds = (value: unknown, into: Set<string>): void => {
    if (Array.isArray(value)) {
      for (const item of value) collectRenderedIds(item, into);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const candidate = value as { id?: unknown };
    if (typeof candidate.id === 'string') into.add(candidate.id);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectRenderedIds(nested, into);
    }
  };

  const visibleIds = new Set(processedFlatList.map((message) => message.id));
  const renderedIds = new Set<string>();
  collectRenderedIds(processedFlatList, renderedIds);
  const recoveredFlatList = [...processedFlatList];

  const insertByCreatedAt = (message: Message) => {
    const createdAt = new Date(message.createdAt).getTime();
    const insertAt = recoveredFlatList.findIndex(
      (candidate) => new Date(candidate.createdAt).getTime() > createdAt,
    );
    if (insertAt === -1) recoveredFlatList.push(message);
    else recoveredFlatList.splice(insertAt, 0, message);
  };

  // A member is recovered only when the shell it hangs off is itself on the
  // active branch. Without that, a shell the user regenerated away from takes
  // its member with it into the transcript — and into the context the next
  // request is built from — while the shell itself stays correctly hidden.
  //
  // "On the active branch" is `renderedIds`, not the top level. A `speak` call
  // that follows an earlier tool call is folded INTO the supervisor's group, so
  // it sits at `flatList[i].children[j]` and never appears in the top-level id
  // set — and its member was dropped for a shell that is plainly on screen
  // (#19566). The same set already decides whether the member itself is
  // rendered, so the two halves of this test now ask the same question.
  const isRecoverableMember = (message: Message) =>
    message.role === 'assistant' &&
    message.metadata?.orchestrationRole === 'member' &&
    !renderedIds.has(message.id) &&
    message.parentId != null &&
    renderedIds.has(message.parentId);

  const hiddenBranchSiblings = processedMessages
    .filter(
      (message) =>
        (message.role === 'taskCallback' && !visibleIds.has(message.id)) ||
        isRecoverableMember(message),
    )
    .toSorted((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const message of hiddenBranchSiblings) insertByCreatedAt(message);

  return {
    contextTree,
    flatList: recoveredFlatList,
    messageMap: messageMapObj,
  };
}
