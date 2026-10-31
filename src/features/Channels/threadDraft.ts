import type { ChannelDetail, ChannelPublicMember, ChannelPublicMessage } from '@lobechat/types';

/** A local preview, never a persisted thread or replica entry. */
export interface ChannelThreadDraft {
  attachments: ChannelDetail['attachments'];
  root: ChannelPublicMessage;
}

/** Preview the same default audience the server derives when the first message is sent. */
export const draftThreadFollowerIds = (
  root: ChannelPublicMessage,
  members: ChannelPublicMember[],
) =>
  members
    .filter(
      (member) =>
        member.status === 'active' &&
        (root.recipientMemberIds.includes(member.id) ||
          (root.author.type === 'agent' &&
            !!root.author.id &&
            member.actorType === 'agent' &&
            member.agentId === root.author.id)),
    )
    .map((member) => member.id);
