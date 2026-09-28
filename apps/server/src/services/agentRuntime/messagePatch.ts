import type { MessagePatchData } from '@lobechat/agent-gateway-client';
import type { UIChatMessage } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

/**
 * Diff two canonical top-level message lists for one native runtime step.
 * Nested compression/member structures remain atomic: if a nested row changes,
 * its top-level envelope is upserted as one unit so the client never has to
 * reproduce server-side conversation-flow grouping rules.
 */
export const buildMessagePatch = (
  before: UIChatMessage[],
  after: UIChatMessage[],
  revision: number,
): MessagePatchData => {
  const beforeById = new Map(before.map((message) => [message.id, message]));
  const afterIds = new Set(after.map((message) => message.id));

  return {
    deletes: before.filter((message) => !afterIds.has(message.id)).map((message) => message.id),
    revision,
    upserts: after.flatMap((message, index) => {
      const previous = beforeById.get(message.id);
      if (previous && isEqual(previous, message)) return [];

      return [
        {
          afterId: index === 0 ? null : after[index - 1].id,
          message,
        },
      ];
    }),
  };
};
