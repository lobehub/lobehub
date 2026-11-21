import type { LobeChatDatabase } from '@lobechat/database';
import type { ContactCard, ContactCardInput, ContactUserProfile } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import type { Transaction } from '@/database/type';

/** Another person's Agent the caller reached through its share and may talk to directly. */
export interface AddressBookAgentAccess {
  agentId: string;
  name: string | null;
  ownerId: string;
  shareId: string;
  title: string | null;
  workspaceId: string | null;
}

/**
 * What Channel and Agent Share ask of a person's address book in one scope: who they can reach
 * one-on-one, the Agents they reached through a share, and who a share's device grant may name.
 */
export interface AddressBook {
  filterAddressBookPeople: (userIds: string[]) => Promise<string[]>;
  findAgentAccess: (agentId: string) => Promise<AddressBookAgentAccess | undefined>;
  findUser: (userId: string) => Promise<ContactUserProfile | undefined>;
  listAddressBookPeople: () => Promise<ContactUserProfile[]>;
  listPeople: (options: {
    limit: number;
    query?: string;
  }) => Promise<{ hasMore: boolean; people: ContactUserProfile[] }>;
  resolveCard: (input: ContactCardInput) => Promise<ContactCard>;
}

/** Without an address book nobody is a contact: every list is empty and no card can be shared. */
const emptyAddressBook: AddressBook = {
  filterAddressBookPeople: async () => [],
  findAgentAccess: async () => undefined,
  findUser: async () => undefined,
  listAddressBookPeople: async () => [],
  listPeople: async () => ({ hasMore: false, people: [] }),
  resolveCard: async () => {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Contact cards are not available' });
  },
};

export const getAddressBook = (
  _db: LobeChatDatabase,
  _userId: string,
  _workspaceId?: string | null,
): AddressBook => emptyAddressBook;

/** Whether two people are contacts in a scope (`null` is the personal space), both ways. */
export const areMutualContacts = async (
  _db: LobeChatDatabase | Transaction,
  _workspaceId: string | null,
  _userId: string,
  _peerUserId: string,
): Promise<boolean> => false;

/** True for the people `userId` can bring into a personal group; `contactUserId` is a column. */
export const mutualPersonalContactWhere = (_userId: string, _contactUserId: SQL | string): SQL =>
  sql`false`;
