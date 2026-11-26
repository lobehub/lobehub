import type { ContactCard, ContactCardInput } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import type { Transaction } from '../../type';
import { ChannelError } from './error';

/**
 * Who counts as a person's contact, for the checks Channel runs inside its own transactions. The
 * server supplies it; without one nobody is a contact, so two people talk one-on-one only as
 * fellow members of a workspace.
 */
export interface ChannelContacts {
  /** Whether two people are contacts in a scope (`null` is the personal space), both ways. */
  areMutualContacts: (
    tx: Transaction,
    workspaceId: string | null,
    userId: string,
    peerUserId: string,
  ) => Promise<boolean>;
  /** True for the people `userId` can bring into a personal group; `contactUserId` is a column. */
  mutualPersonalContactWhere: (userId: string, contactUserId: SQL) => SQL;
  /** The card a person shares into a conversation, checked and snapshotted as it is sent. */
  resolveCard: (
    tx: Transaction,
    userId: string,
    workspaceId: string | null,
    input: ContactCardInput,
  ) => Promise<ContactCard>;
}

export const noChannelContacts: ChannelContacts = {
  areMutualContacts: async () => false,
  mutualPersonalContactWhere: () => sql`false`,
  resolveCard: async () => {
    throw new ChannelError('FORBIDDEN', 'Contact cards are not available');
  },
};
