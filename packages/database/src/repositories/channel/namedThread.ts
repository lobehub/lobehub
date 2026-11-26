import type { Transaction } from '../../type';
import type { ChannelContacts } from './contacts';
import { sendMessage } from './send';
import type { ChannelAccess } from './types';
import { createChannelThread } from './view';

export interface NamedThreadInput {
  /** Keys the root, so a retry returns the same Thread. */
  requestKey: string;
  title: string;
}

/**
 * Opens a Thread a person names before anyone writes in it: the name is posted on the main
 * timeline for the record, waking no Agent, and the Thread opens on it with the person following.
 * The caller holds the channel lock and is `access.member`.
 */
export const createNamedThread = async (
  tx: Transaction,
  access: ChannelAccess,
  input: NamedThreadInput,
  contacts: ChannelContacts,
) => {
  const root = await sendMessage(
    tx,
    access,
    { content: input.title, requestKey: input.requestKey, routing: 'fallback', silent: true },
    contacts,
  );
  return createChannelThread(tx, access.channel.id, {
    followerMemberIds: [access.member.id],
    rootMessageId: root.id,
  });
};
