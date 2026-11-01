import type { UIChatMessage } from '@lobechat/types';

type ReasoningReplayNode = {
  children?: ReasoningReplayNode[];
  members?: ReasoningReplayNode[];
  reasoning?: unknown;
};

/**
 * Strip stored assistant `reasoning` from messages before they are replayed
 * back into a model request. Recurses into `children` / `members` (grouped /
 * council messages) and returns the same array reference when nothing changed,
 * so callers can cheaply detect a no-op.
 *
 * Used by the `call_llm` stage when the reasoning-replay gate is off: most
 * providers reject or mis-handle prior-turn reasoning fed back as input, so it
 * is dropped unless replay is explicitly enabled.
 */
export const stripAssistantReasoningForReplay = (messages: UIChatMessage[]): UIChatMessage[] => {
  const stripMessage = <T extends ReasoningReplayNode>(message: T): T => {
    let changed = false;

    const children = message.children?.map((child) => {
      const strippedChild = stripMessage(child);
      if (strippedChild !== child) changed = true;
      return strippedChild;
    });

    const members = message.members?.map((member) => {
      const strippedMember = stripMessage(member);
      if (strippedMember !== member) changed = true;
      return strippedMember;
    });

    if ('reasoning' in message) changed = true;
    if (!changed) return message;

    const { reasoning: _reasoning, ...messageWithoutReasoning } = message;

    return {
      ...messageWithoutReasoning,
      ...(children ? { children } : {}),
      ...(members ? { members } : {}),
    } as T;
  };

  let changed = false;

  const strippedMessages = messages.map((message) => {
    const strippedMessage = stripMessage(message);
    if (strippedMessage !== message) changed = true;
    return strippedMessage;
  });

  return changed ? strippedMessages : messages;
};
