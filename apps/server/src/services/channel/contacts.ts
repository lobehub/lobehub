import type { LobeChatDatabase } from '@lobechat/database';

import {
  areMutualContacts,
  getAddressBook,
  mutualPersonalContactWhere,
} from '@/business/server/contact/addressBook';
import type { ChannelContacts } from '@/database/repositories/channel';

/** The address book answering Channel's contact checks, inside the transaction that runs them. */
export const channelContacts: ChannelContacts = {
  areMutualContacts,
  mutualPersonalContactWhere,
  resolveCard: (tx, userId, workspaceId, input) =>
    getAddressBook(tx as unknown as LobeChatDatabase, userId, workspaceId).resolveCard(input),
};
