import type {
  ContactAgentItem,
  ContactAgentProfile,
  ContactItem,
  ContactRelation,
  ContactRequestItem,
  ContactSearchResult,
  ContactUserItem,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agents, agentShares, userContactRequests, userContacts, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '../utils/inboxAgent';
import { notTrashed } from '../utils/softDelete';
import { isUuid } from '../utils/uuid';

const userProfileColumns = {
  avatar: users.avatar,
  fullName: users.fullName,
  id: users.id,
  username: users.username,
};

const owners = alias(users, 'contact_agent_owner');

/** Columns of an Agent reached through its share, with the owner joined as `owners`. */
const agentProfileColumns = {
  agentAvatar: agents.avatar,
  agentBackgroundColor: agents.backgroundColor,
  agentDescription: agents.description,
  agentId: agents.id,
  agentSlug: agents.slug,
  agentTitle: agents.title,
  isDeleted: agents.isDeleted,
  ownerAvatar: owners.avatar,
  ownerFullName: owners.fullName,
  ownerId: owners.id,
  ownerUsername: owners.username,
  shareId: agentShares.id,
  shareSlug: sql<string | null>`${agentShares.shareConfig} ->> 'slug'`,
  visibility: agentShares.visibility,
};

type AgentProfileRow = {
  agentAvatar: string | null;
  agentBackgroundColor: string | null;
  agentDescription: string | null;
  agentId: string;
  agentSlug: string | null;
  agentTitle: string | null;
  ownerAvatar: string | null;
  ownerFullName: string | null;
  ownerId: string | null;
  ownerUsername: string | null;
  shareId: string;
  shareSlug: string | null;
};

const toAgentProfile = (row: AgentProfileRow): ContactAgentProfile => ({
  agentId: row.agentId,
  avatar: normalizeInboxAgentAvatar(row.agentAvatar, { slug: row.agentSlug }) ?? null,
  backgroundColor: row.agentBackgroundColor,
  description: row.agentDescription,
  owner: {
    avatar: row.ownerAvatar,
    fullName: row.ownerFullName,
    id: row.ownerId ?? '',
    username: row.ownerUsername,
  },
  shareId: row.shareId,
  slug: row.shareSlug,
  title: normalizeInboxAgentTitle(row.agentTitle, { slug: row.agentSlug }) ?? null,
});

/** Share handles are stored lowercase; accept `@handle`, `/a/handle` and full share URLs. */
export const parseContactHandle = (query: string): string | undefined => {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const fromPath = trimmed.match(/\/a\/([^/?#\s]+)/);
  const handle = (fromPath ? decodeURIComponent(fromPath[1]) : trimmed).replace(/^@/, '');
  return handle || undefined;
};

/**
 * A person's address book and contact requests. Every method acts as `userId`; another
 * person's rows are only touched as the second half of a mutual relation. People are personal: a
 * workspace lists none, its colleagues being its members. Agents are the scope's: in the personal space the caller's own, in a workspace
 * the ones any member added there, which every member sees and may remove.
 */
export class ContactModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId || null;
  }

  /** The Agent entries of this scope's address book. */
  private agentEntryWhere() {
    return this.workspaceId
      ? and(eq(userContacts.type, 'agent'), eq(userContacts.workspaceId, this.workspaceId))
      : and(
          eq(userContacts.userId, this.userId),
          eq(userContacts.type, 'agent'),
          isNull(userContacts.workspaceId),
        );
  }

  list = async (): Promise<ContactItem[]> => {
    const [people, sharedAgents] = await Promise.all([
      this.workspaceId
        ? []
        : this.db
            .select({ createdAt: userContacts.createdAt, user: userProfileColumns })
            .from(userContacts)
            .innerJoin(users, eq(users.id, userContacts.contactUserId))
            .where(and(eq(userContacts.userId, this.userId), eq(userContacts.type, 'user')))
            .orderBy(desc(userContacts.createdAt)),
      this.db
        .select({ createdAt: userContacts.createdAt, ...agentProfileColumns })
        .from(userContacts)
        .innerJoin(agents, eq(agents.id, userContacts.agentId))
        .innerJoin(agentShares, eq(agentShares.agentId, agents.id))
        .leftJoin(owners, eq(owners.id, agents.userId))
        .where(this.agentEntryWhere())
        .orderBy(desc(userContacts.createdAt)),
    ]);

    const userItems: ContactUserItem[] = people.map((row) => ({
      createdAt: row.createdAt,
      type: 'user',
      user: row.user,
    }));
    const agentItems: ContactAgentItem[] = sharedAgents.map((row) => ({
      agent: toAgentProfile(row),
      available: row.visibility === 'link' && !row.isDeleted,
      createdAt: row.createdAt,
      type: 'agent',
    }));

    return [...userItems, ...agentItems];
  };

  // ── People ────────────────────────────────────────────────────────────

  isContact = async (contactUserId: string): Promise<boolean> => {
    const [row] = await this.db
      .select({ id: userContacts.id })
      .from(userContacts)
      .where(
        and(eq(userContacts.userId, this.userId), eq(userContacts.contactUserId, contactUserId)),
      )
      .limit(1);
    return !!row;
  };

  /** A person's public profile; only the fields the address book shows. */
  findUser = async (userId: string) => {
    const [user] = await this.db
      .select(userProfileColumns)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user;
  };

  relationTo = async (otherUserId: string): Promise<ContactRelation> => {
    if (otherUserId === this.userId) return 'self';
    if (await this.isContact(otherUserId)) return 'contact';
    const [pending] = await this.db
      .select({ requesterId: userContactRequests.requesterId })
      .from(userContactRequests)
      .where(and(eq(userContactRequests.status, 'pending'), this.pairWhere(otherUserId)))
      .limit(1);
    if (!pending) return 'none';
    return pending.requesterId === this.userId ? 'request_sent' : 'request_received';
  };

  /**
   * Ask `addresseeId` to become mutual contacts. Repeating a pending request returns it; a
   * request sent while theirs is pending accepts theirs instead.
   */
  sendRequest = async (
    addresseeId: string,
    message?: string,
  ): Promise<{ requestId: string; status: 'accepted' | 'pending' }> => {
    if (addresseeId === this.userId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot add yourself' });

    return this.db.transaction(async (tx) => {
      const [addressee] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, addresseeId))
        .limit(1);
      if (!addressee) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      // Serialize the pair so two crossing requests cannot both stay pending.
      await this.lockPair(tx, addresseeId);

      const [existing] = await tx
        .select({ id: userContacts.id })
        .from(userContacts)
        .where(
          and(eq(userContacts.userId, this.userId), eq(userContacts.contactUserId, addresseeId)),
        )
        .limit(1);
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Already a contact' });

      const [pending] = await tx
        .select({ id: userContactRequests.id, requesterId: userContactRequests.requesterId })
        .from(userContactRequests)
        .where(and(eq(userContactRequests.status, 'pending'), this.pairWhere(addresseeId)))
        .limit(1);
      if (pending?.requesterId === this.userId) return { requestId: pending.id, status: 'pending' };
      // Their pending request is answered by mine, unless they withdrew it meanwhile; then mine
      // goes out as a new request.
      if (pending && (await this.accept(tx, pending.id, addresseeId)))
        return { requestId: pending.id, status: 'accepted' };

      const [created] = await tx
        .insert(userContactRequests)
        .values({ addresseeId, message: message?.trim() || null, requesterId: this.userId })
        .returning({ id: userContactRequests.id });
      return { requestId: created.id, status: 'pending' };
    });
  };

  listRequests = async (): Promise<ContactRequestItem[]> => {
    const rows = await this.db
      .select({
        addresseeId: userContactRequests.addresseeId,
        createdAt: userContactRequests.createdAt,
        id: userContactRequests.id,
        message: userContactRequests.message,
        requesterId: userContactRequests.requesterId,
        user: userProfileColumns,
      })
      .from(userContactRequests)
      .innerJoin(
        users,
        sql`${users.id} = CASE WHEN ${userContactRequests.requesterId} = ${this.userId} THEN ${userContactRequests.addresseeId} ELSE ${userContactRequests.requesterId} END`,
      )
      .where(
        and(
          eq(userContactRequests.status, 'pending'),
          or(
            eq(userContactRequests.requesterId, this.userId),
            eq(userContactRequests.addresseeId, this.userId),
          ),
        ),
      )
      .orderBy(desc(userContactRequests.createdAt));

    return rows.map((row) => ({
      createdAt: row.createdAt,
      direction: row.requesterId === this.userId ? 'outgoing' : 'incoming',
      id: row.id,
      message: row.message,
      user: row.user,
    }));
  };

  /** Accept a pending request sent to me; both people become each other's contact. */
  acceptRequest = async (requestId: string): Promise<{ contactUserId: string }> =>
    this.db.transaction(async (tx) => {
      const request = await this.incomingPending(tx, requestId);
      await this.lockPair(tx, request.requesterId);
      if (!(await this.accept(tx, request.id, request.requesterId)))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      return { contactUserId: request.requesterId };
    });

  declineRequest = async (requestId: string) => {
    await this.db.transaction(async (tx) => {
      const request = await this.incomingPending(tx, requestId);
      // Same rule as accepting: only a request still pending can be answered.
      const [declined] = await tx
        .update(userContactRequests)
        .set({ respondedAt: new Date(), status: 'declined', updatedAt: new Date() })
        .where(
          and(eq(userContactRequests.id, request.id), eq(userContactRequests.status, 'pending')),
        )
        .returning({ id: userContactRequests.id });
      if (!declined) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    });
  };

  cancelRequest = async (requestId: string) => {
    if (!isUuid(requestId))
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    const [cancelled] = await this.db
      .update(userContactRequests)
      .set({ respondedAt: new Date(), status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(userContactRequests.id, requestId),
          eq(userContactRequests.requesterId, this.userId),
          eq(userContactRequests.status, 'pending'),
        ),
      )
      .returning({ id: userContactRequests.id });
    if (!cancelled) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
  };

  /** Remove a person from my contacts; the relation is mutual, so both entries go. */
  removeUser = async (contactUserId: string) => {
    await this.db
      .delete(userContacts)
      .where(
        or(
          and(eq(userContacts.userId, this.userId), eq(userContacts.contactUserId, contactUserId)),
          and(eq(userContacts.userId, contactUserId), eq(userContacts.contactUserId, this.userId)),
        ),
      );
  };

  // ── Agents ────────────────────────────────────────────────────────────

  /** Add another person's Agent in this scope through its link share (share id or handle). */
  addAgent = async (shareIdOrSlug: string): Promise<ContactAgentProfile> => {
    const share = await this.findLinkShare(shareIdOrSlug);
    if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
    if (share.ownerId === this.userId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This Agent is already yours' });

    await this.db
      .insert(userContacts)
      .values({
        agentId: share.agentId,
        type: 'agent',
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .onConflictDoNothing();
    return toAgentProfile(share);
  };

  removeAgent = async (agentId: string) => {
    await this.db
      .delete(userContacts)
      .where(and(this.agentEntryWhere(), eq(userContacts.agentId, agentId)));
  };

  /**
   * The live share that authorizes me to message another person's Agent: its entry in this
   * scope's address book plus its link share. Returns undefined for my own Agents, which need no
   * share.
   */
  findAgentAccess = async (agentId: string) => {
    const [row] = await this.db
      .select({
        agentId: agents.id,
        name: agents.name,
        ownerId: agents.userId,
        shareId: agentShares.id,
        title: agents.title,
        workspaceId: agents.workspaceId,
      })
      .from(userContacts)
      .innerJoin(agents, eq(agents.id, userContacts.agentId))
      .innerJoin(agentShares, eq(agentShares.agentId, agents.id))
      .where(
        and(
          this.agentEntryWhere(),
          eq(userContacts.agentId, agentId),
          eq(agentShares.visibility, 'link'),
          notTrashed(agents.isDeleted),
        ),
      )
      .limit(1);
    if (!row?.ownerId || row.ownerId === this.userId) return undefined;
    return { ...row, ownerId: row.ownerId };
  };

  /**
   * Agents a person shares by link, for their profile card. A link share is open to anyone
   * signed in, so the list is too; it does not need the person as a contact.
   */
  listSharedAgentsOf = async (ownerId: string): Promise<ContactAgentProfile[]> => {
    const rows = await this.db
      .select(agentProfileColumns)
      .from(agentShares)
      .innerJoin(agents, eq(agents.id, agentShares.agentId))
      .leftJoin(owners, eq(owners.id, agents.userId))
      .where(
        and(
          eq(agents.userId, ownerId),
          eq(agentShares.visibility, 'link'),
          notTrashed(agents.isDeleted),
        ),
      )
      .orderBy(desc(agentShares.createdAt));
    return rows.map(toAgentProfile);
  };

  // ── Search ────────────────────────────────────────────────────────────

  /**
   * Exact handle lookup: a person's username and an Agent's share handle, plus a pasted share
   * link. No fuzzy search, so a stranger cannot enumerate accounts.
   */
  search = async (query: string): Promise<ContactSearchResult[]> => {
    const handle = parseContactHandle(query);
    if (!handle) return [];
    const results: ContactSearchResult[] = [];

    const [person] = await this.db
      .select(userProfileColumns)
      .from(users)
      .where(sql`lower(${users.username}) = ${handle.toLowerCase()}`)
      .limit(1);
    if (person)
      results.push({ relation: await this.relationTo(person.id), type: 'user', user: person });

    const share = await this.findLinkShare(handle);
    if (share) {
      const relation =
        share.ownerId === this.userId
          ? 'self'
          : (await this.findAgentAccess(share.agentId))
            ? 'contact'
            : 'none';
      results.push({ agent: toAgentProfile(share), relation, type: 'agent' });
    }

    return results;
  };

  // ── Internals ─────────────────────────────────────────────────────────

  private pairWhere(otherUserId: string) {
    return or(
      and(
        eq(userContactRequests.requesterId, this.userId),
        eq(userContactRequests.addresseeId, otherUserId),
      ),
      and(
        eq(userContactRequests.requesterId, otherUserId),
        eq(userContactRequests.addresseeId, this.userId),
      ),
    );
  }

  /** Transaction-scoped advisory lock on the unordered pair. */
  private async lockPair(tx: Pick<LobeChatDatabase, 'execute'>, otherUserId: string) {
    const [a, b] = [this.userId, otherUserId].sort();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`contact:${a}:${b}`}))`);
  }

  private async incomingPending(tx: Pick<LobeChatDatabase, 'select'>, requestId: string) {
    if (!isUuid(requestId))
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    const [request] = await tx
      .select({ id: userContactRequests.id, requesterId: userContactRequests.requesterId })
      .from(userContactRequests)
      .where(
        and(
          eq(userContactRequests.id, requestId),
          eq(userContactRequests.addresseeId, this.userId),
          eq(userContactRequests.status, 'pending'),
        ),
      )
      .limit(1);
    if (!request) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    return request;
  }

  /**
   * Move a request from pending to accepted and add both contact entries. The transition is
   * conditional on the row still being pending: a withdrawal or decline that committed after the
   * request was read wins, and no contacts are added. Returns whether it was accepted.
   */
  private async accept(
    tx: Pick<LobeChatDatabase, 'insert' | 'update'>,
    requestId: string,
    requesterId: string,
  ): Promise<boolean> {
    const now = new Date();
    const [accepted] = await tx
      .update(userContactRequests)
      .set({ respondedAt: now, status: 'accepted', updatedAt: now })
      .where(and(eq(userContactRequests.id, requestId), eq(userContactRequests.status, 'pending')))
      .returning({ id: userContactRequests.id });
    if (!accepted) return false;
    await tx
      .insert(userContacts)
      .values([
        { contactUserId: requesterId, type: 'user', userId: this.userId },
        { contactUserId: this.userId, type: 'user', userId: requesterId },
      ])
      .onConflictDoNothing();
    return true;
  }

  private async findLinkShare(shareIdOrSlug: string) {
    const key = parseContactHandle(shareIdOrSlug);
    if (!key) return undefined;
    const [row] = await this.db
      .select(agentProfileColumns)
      .from(agentShares)
      .innerJoin(agents, eq(agents.id, agentShares.agentId))
      .leftJoin(owners, eq(owners.id, agents.userId))
      .where(
        and(
          isUuid(key)
            ? eq(agentShares.id, key)
            : sql`${agentShares.shareConfig} ->> 'slug' = ${key.toLowerCase()}`,
          eq(agentShares.visibility, 'link'),
          notTrashed(agents.isDeleted),
        ),
      )
      .limit(1);
    return row;
  }
}
