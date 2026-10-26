import type { AssistantContentBlock } from '@lobechat/types';

import type { Message } from '../types';

/**
 * Snapshot post-task-summary turns as content blocks for an AssistantGroup.
 * They render after `<SignalCallbacks>` inside the same group, each through its
 * own `<Group>` that pulls live content from the store by block id (no need to
 * denormalize text here — keeps streaming updates working without an extra
 * refresh). The block keeps the turn's signal lineage, so the renderer can mark
 * which tool's completion woke it.
 */
export const toTaskCompletionBlocks = (messages: Message[]): AssistantContentBlock[] =>
  messages.map((m) => {
    const block: AssistantContentBlock = {
      content: m.content ?? '',
      id: m.id,
    };
    if (m.error) block.error = m.error;
    if (m.fileList && m.fileList.length > 0) block.fileList = m.fileList;
    if (m.imageList && m.imageList.length > 0) block.imageList = m.imageList;
    if (m.performance) block.performance = m.performance;
    if (m.reasoning) block.reasoning = m.reasoning;
    if (m.usage) block.usage = m.usage;
    const signal = (m.metadata as { signal?: unknown } | null | undefined)?.signal;
    if (signal) block.metadata = { signal };
    return block;
  });
