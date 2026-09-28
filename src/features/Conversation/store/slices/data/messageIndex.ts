import type { UIChatMessage } from '@lobechat/types';

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
