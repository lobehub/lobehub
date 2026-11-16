import type {
  AssistantContentBlock,
  ChatToolPayloadWithResult,
  UIChatMessage,
} from '@lobechat/types';

/**
 * Snapshot indexes over the conversation's message arrays.
 *
 * Every row of a long transcript subscribes to the store with a few selectors,
 * and every streaming chunk re-runs all of them. A selector that walks the
 * transcript makes one chunk cost rows × messages — a few hundred tool calls
 * in one turn is enough to freeze the page. Both arrays are replaced (never
 * mutated) on each dispatch, so an index keyed on the array identity is built
 * once per snapshot no matter how many rows read it, and each lookup is O(1).
 */

interface DisplayMessageIndex {
  byId: Map<string, UIChatMessage>;
  groupOfBlock: Map<string, UIChatMessage>;
}

const buildIndex = (messages: UIChatMessage[]): DisplayMessageIndex => {
  const byId = new Map<string, UIChatMessage>();
  const groupOfBlock = new Map<string, UIChatMessage>();

  for (const message of messages) {
    byId.set(message.id, message);
    if (message.role !== 'assistantGroup') continue;
    for (const block of message.children ?? []) groupOfBlock.set(block.id, message);
  }

  return { byId, groupOfBlock };
};

// Streaming swaps the displayMessages array on every chunk; keying on the array
// identity keeps the pass to once per snapshot no matter how many rows read it.
const indexCache = new WeakMap<UIChatMessage[], DisplayMessageIndex>();

export const indexDisplayMessages = (messages: UIChatMessage[]): DisplayMessageIndex => {
  let index = indexCache.get(messages);
  if (!index) {
    index = buildIndex(messages);
    indexCache.set(messages, index);
  }
  return index;
};

// ===== Assistant content blocks =====

export const toAssistantContentBlock = (message: UIChatMessage): AssistantContentBlock => ({
  content: message.content,
  error: message.error,
  fileList: message.fileList,
  id: message.id,
  imageList: message.imageList,
  metadata: message.metadata ?? undefined,
  performance: message.performance,
  reasoning: message.reasoning ?? undefined,
  tasks: message.tasks as AssistantContentBlock['tasks'],
  tools: message.tools as ChatToolPayloadWithResult[],
  usage: message.usage,
});

// `stabilizeReferences` keeps an unchanged message object across snapshots, so
// caching its block projection per object keeps the block (and its `tools`)
// reference-stable too — selectors can then compare by identity.
const standaloneBlockCache = new WeakMap<UIChatMessage, AssistantContentBlock>();

const standaloneBlockOf = (message: UIChatMessage): AssistantContentBlock => {
  let block = standaloneBlockCache.get(message);
  if (!block) {
    block = toAssistantContentBlock(message);
    standaloneBlockCache.set(message, block);
  }
  return block;
};

/**
 * Index every assistant content block reachable from the display list:
 * standalone assistant rows, group children, compressed groups and agent
 * council members. Walk order and "first match wins" mirror a depth-first
 * search, so a duplicated id resolves to the same block a linear search would.
 */
const buildBlockIndex = (messages: UIChatMessage[], index: Map<string, AssistantContentBlock>) => {
  for (const message of messages) {
    if (message.role === 'assistant' && !index.has(message.id)) {
      index.set(message.id, standaloneBlockOf(message));
    }
    if (message.children) {
      for (const child of message.children) {
        if (!index.has(child.id)) index.set(child.id, child);
      }
    }
    if (message.compressedMessages) buildBlockIndex(message.compressedMessages, index);
    if (message.role === 'agentCouncil' && (message as any).members) {
      buildBlockIndex((message as any).members, index);
    }
  }
  return index;
};

const blockIndexCache = new WeakMap<UIChatMessage[], Map<string, AssistantContentBlock>>();

export const findBlockInDisplayMessages = (
  messages: UIChatMessage[],
  blockId: string,
): AssistantContentBlock | undefined => {
  let index = blockIndexCache.get(messages);
  if (!index) {
    index = buildBlockIndex(messages, new Map());
    blockIndexCache.set(messages, index);
  }
  return index.get(blockId);
};

// A block normally carries a handful of tools, but a parallel fan-out can carry
// hundreds; index them per `tools` array (stable while the block is unchanged).
const toolIndexCache = new WeakMap<
  ChatToolPayloadWithResult[],
  Map<string, ChatToolPayloadWithResult>
>();

export const findToolInList = (
  tools: ChatToolPayloadWithResult[],
  toolCallId: string,
): ChatToolPayloadWithResult | undefined => {
  let index = toolIndexCache.get(tools);
  if (!index) {
    index = new Map();
    for (const tool of tools) if (!index.has(tool.id)) index.set(tool.id, tool);
    toolIndexCache.set(tools, index);
  }
  return index.get(toolCallId);
};

// ===== Raw db rows =====

interface DbMessageIndex {
  byId: Map<string, UIChatMessage>;
  byToolCallId: Map<string, UIChatMessage>;
}

const dbIndexCache = new WeakMap<UIChatMessage[], DbMessageIndex>();

export const indexDbMessages = (messages: UIChatMessage[]): DbMessageIndex => {
  let index = dbIndexCache.get(messages);
  if (!index) {
    const byId = new Map<string, UIChatMessage>();
    const byToolCallId = new Map<string, UIChatMessage>();
    for (const message of messages) {
      if (!byId.has(message.id)) byId.set(message.id, message);
      if (message.tool_call_id && !byToolCallId.has(message.tool_call_id)) {
        byToolCallId.set(message.tool_call_id, message);
      }
    }
    index = { byId, byToolCallId };
    dbIndexCache.set(messages, index);
  }
  return index;
};
