import type { UIChatMessage, UISignalCallbacksBlock } from '@lobechat/types';

import type { AssistantContentBlock } from '@/types/index';

import type { SteerContinuation } from '../../../store/slices/data/steerChains';
import type { GroupChainInput } from '../components/groupChain';

export const buildContinuationChains = (
  continuations: SteerContinuation[],
  continuationMessages: Array<UIChatMessage | undefined>,
): GroupChainInput[] =>
  continuations.flatMap((continuation, index) => {
    const message = continuationMessages[index];
    if (!message) return [];

    const blocks =
      message.role === 'assistant'
        ? [message as unknown as AssistantContentBlock]
        : [...(message.children ?? []), ...(message.taskCompletions ?? [])];

    return [
      {
        blocks,
        id: continuation.groupId,
        steerUserId: continuation.steerUserId,
      },
    ];
  });

export const collectSignalCallbacks = (
  signalCallbacks: UISignalCallbacksBlock[] | undefined,
  continuationMessages: Array<UIChatMessage | undefined>,
): UISignalCallbacksBlock[] => [
  ...(signalCallbacks ?? []),
  ...continuationMessages.flatMap((message) => message?.signalCallbacks ?? []),
];
