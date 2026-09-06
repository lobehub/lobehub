import type { UIChatMessage } from '@lobechat/types';

export interface ChatRowContinuation {
  groupId: string;
  steerUserId: string;
}

export interface ChatRow {
  continuations?: ChatRowContinuation[];
  id: string;
  /** Steer bubbles render inside the chain while it is still running; once it settles they are hoisted above it as regular rows. */
  inlineSteer?: boolean;
}

const isTurnHost = (message?: UIChatMessage) =>
  message?.role === 'assistantGroup' || message?.role === 'supervisor';

const isTurnTail = (message?: UIChatMessage) =>
  isTurnHost(message) || message?.role === 'assistant';

const isSteerUser = (message?: UIChatMessage) =>
  message?.role === 'user' && !!message.metadata?.steer;

export const buildChatRows = (
  messages: UIChatMessage[],
  options: { isStreaming: boolean },
): ChatRow[] => {
  const rows: ChatRow[] = [];
  let chain: ChatRow | undefined;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const next = messages[index + 1];

    if (chain && isSteerUser(message) && isTurnTail(next)) {
      chain.continuations = [
        ...(chain.continuations ?? []),
        { groupId: next!.id, steerUserId: message.id },
      ];
      index += 1;
      continue;
    }

    const row: ChatRow = { id: message.id };
    rows.push(row);
    chain = isTurnHost(message) ? row : undefined;
  }

  const result: ChatRow[] = [];
  rows.forEach((row, index) => {
    if (!row.continuations) {
      result.push(row);
      return;
    }

    const inlineSteer = options.isStreaming && index === rows.length - 1;
    if (!inlineSteer) {
      for (const continuation of row.continuations) {
        result.push({ id: continuation.steerUserId });
      }
    }
    result.push({ ...row, inlineSteer });
  });

  return result;
};
