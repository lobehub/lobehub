import type { AssistantContentBlock } from '@lobechat/types';

import { parse } from '../parse';
import type { FlatMessage, Message } from '../types';

export type ConversationTailKind = 'group' | 'single';

export interface ConversationTail {
  kind: ConversationTailKind;
  message: FlatMessage;
}

export const resolveConversationTail = (messages: Message[]): ConversationTail | undefined => {
  const message = parse(messages).flatList.at(-1);
  if (!message) return undefined;

  return { kind: message.role === 'assistantGroup' ? 'group' : 'single', message };
};

export const getOperationFinalRootId = (
  metadata?: { work?: { rootOperationId?: unknown } } | null,
) =>
  typeof metadata?.work?.rootOperationId === 'string' ? metadata.work.rootOperationId : undefined;

export const findLatestWorkRootOperationId = (
  metadata?: { work?: { rootOperationId?: unknown } } | null,
  children?: AssistantContentBlock[],
  taskCompletions?: AssistantContentBlock[],
) => {
  const blocks = [...(children ?? []), ...(taskCompletions ?? [])];

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const rootOperationId = getOperationFinalRootId(blocks[index]?.metadata);
    if (rootOperationId) return rootOperationId;
  }

  return getOperationFinalRootId(metadata);
};
