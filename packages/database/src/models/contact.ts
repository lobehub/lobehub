import type {
  ContactAgentItem,
  ContactAgentProfile,
  ContactCard,
  ContactCardInput,
  ContactItem,
  ContactRelation,
  ContactRequestItem,
  ContactRequestSource,
  ContactSearchResult,
  ContactUserItem,
  ContactUserProfile,
  ContactWorkspace,
} from '@lobechat/types';
import { agentDisplayName, channelMessageDeletedAt, contactCardOf } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import type { SQLWrapper } from 'drizzle-orm';
import { and, desc, eq, exists, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  agents,
  agentShares,
  channelMembers,
  channelMessages,
  userContactRequests,
  userContacts,
  users,
  workspaceMembers,
  workspaces,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { agentShareAdmits } from '../utils/agentShareAdmits';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '../utils/inboxAgent';
import { ilikeContains } from '../utils/like';
import { notTrashed } from '../utils/softDelete';
import { isUuid } from '../utils/uuid';
import { AgentShareModel } from './agentShare';

const userProfileColumns = {
  avatar: users.avatar,
  fullName: users.fullName,
  id: users.id,
  username: users.username,
};

const owners = alias(users, 'contact_agent_owner');
const referrers = alias(users, 'contact_request_referrer');

/** Who the caller is in the active scope. */
type ScopeRole = 'personal' | 'member' | 'external';

const WORKSPACE_MANAGER_ROLES = ['owner', 'admin'];

/** `userId` (a value or a column) is an active member of the workspace. */
const activeMemberWhere = (workspaceId: string, userId: string | SQLWrapper) =>
  and(
    eq(workspaceMembers.workspaceId, workspaceId),
    eq(workspaceMembers.userId, userId as string),
    isNull(workspaceMembers.deletedAt),
  );

/** Columns of an Agent reached through its share, with the owner joined as `owners`. */
const agentProfileColumns = {
  agentAvatar: agents.avatar,
  agentBackgroundColor: agents.backgroundColor,
  agentDescription: agents.description,
  agentId: agents.id,
  agentName: agents.name,
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
  agentName: string | null;
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
  name: row.agentName?.trim() || null,
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
 * A person's address book and contact requests in one scope. Every method acts as `userId`;
 * another person's rows are only touched as the second half of a mutual relation.
 *
 * People are the scope's. In the personal space they are personal contacts. In a workspace,
 * colleagues are its members and need no entry; the address book holds its external contacts,
 * people outside it paired with the members who opened themselves to them. A member sees every
 * external contact; an external contact sees only the members paired with them and nothing else
 * of the workspace. Agents are the scope's too: in the personal space the caller's own, in a
 * workspace the ones any member added there, which every member sees and may remove.
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

  #scopeRole?: Promise<ScopeRole>;

  /**
   * Who the caller is in the active scope. In a workspace, an entry pairing them with a member
   * makes them an external contact; anyone else is refused.
   */
  private scopeRole = (): Promise<ScopeRole> => (this.#scopeRole ??= this.loadScopeRole());

  private async loadScopeRole(): Promise<ScopeRole> {
    if (!this.workspaceId) return 'personal';
    if (await this.isMember(this.userId)) return 'member';
    const [entry] = await this.db
      .select({ id: userContacts.id })
      .from(userContacts)
      .where(and(this.userEntryWhere(), eq(userContacts.userId, this.userId)))
      .limit(1);
    if (entry) return 'external';
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this workspace' });
  }

  private async isMember(userId: string) {
    if (!this.workspaceId) return false;
    const [row] = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(activeMemberWhere(this.workspaceId, userId))
      .limit(1);
    return !!row;
  }

  /** The person entries of this scope's address book. */
  private userEntryWhere() {
    return and(
      eq(userContacts.type, 'user'),
      this.workspaceId
        ? eq(userContacts.workspaceId, this.workspaceId)
        : isNull(userContacts.workspaceId),
    );
  }

  /** Requests of this scope: personal ones, or the ones members sent from this workspace. */
  private requestScopeWhere() {
    return this.workspaceId
      ? eq(userContactRequests.workspaceId, this.workspaceId)
      : isNull(userContactRequests.workspaceId);
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
    const role = await this.scopeRole();
    const [userItems, sharedAgents] = await Promise.all([
      role === 'member' ? this.listExternals() : this.listOwnPeople(role),
      // The workspace's Agents are its members' business, not an external contact's.
      role === 'external'
        ? []
        : this.db
            .select({
              admitted: sql<boolean>`${agentShareAdmits(this.userId)}`,
              createdAt: userContacts.createdAt,
              ...agentProfileColumns,
            })
            .from(userContacts)
            .innerJoin(agents, eq(agents.id, userContacts.agentId))
            .innerJoin(agentShares, eq(agentShares.agentId, agents.id))
            .leftJoin(owners, eq(owners.id, agents.userId))
            .where(this.agentEntryWhere())
            .orderBy(desc(userContacts.createdAt)),
    ]);

    const agentItems: ContactAgentItem[] = sharedAgents.map((row) => ({
      agent: toAgentProfile(row),
      // A workspace's Agent entries are shared, but a card share admits each person on their own.
      available: row.admitted && !row.isDeleted,
      createdAt: row.createdAt,
      type: 'agent',
    }));

    return [...userItems, ...agentItems];
  };

  /**
   * My own entries: personal contacts, or, for an external contact, the members paired with them
   * who are still members.
   */
  private async listOwnPeople(role: ScopeRole): Promise<ContactUserItem[]> {
    const rows = await this.db
      .select({ createdAt: userContacts.createdAt, user: userProfileColumns })
      .from(userContacts)
      .innerJoin(users, eq(users.id, userContacts.contactUserId))
      .where(
        and(
          this.userEntryWhere(),
          eq(userContacts.userId, this.userId),
          role === 'external' ? this.contactIsMember() : undefined,
        ),
      )
      .orderBy(desc(userContacts.createdAt));
    return rows.map((row) => ({ createdAt: row.createdAt, type: 'user', user: row.user }));
  }

  /** The entry's `contact_user_id` is an active member of the workspace. */
  private contactIsMember() {
    return exists(
      this.db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(activeMemberWhere(this.workspaceId!, userContacts.contactUserId)),
    );
  }

  /** Every external contact of the workspace, as a member sees them. */
  private async listExternals(): Promise<ContactUserItem[]> {
    const rows = await this.db
      .select({
        createdAt: userContacts.createdAt,
        pairedUserId: userContacts.userId,
        user: userProfileColumns,
      })
      .from(userContacts)
      .innerJoin(users, eq(users.id, userContacts.contactUserId))
      .where(and(this.userEntryWhere(), not(this.contactIsMember())))
      .orderBy(userContacts.createdAt);

    const byUser = new Map<string, ContactUserItem>();
    for (const row of rows) {
      const openedToMe = row.pairedUserId === this.userId;
      const item = byUser.get(row.user.id);
      if (item) item.external!.openedToMe ||= openedToMe;
      else
        byUser.set(row.user.id, {
          createdAt: row.createdAt,
          external: { openedToMe },
          type: 'user',
          user: row.user,
        });
    }
    return [...byUser.values()].reverse();
  }

  // ── People ────────────────────────────────────────────────────────────

  /** Whether I am paired with the person in this scope. */
  isContact = async (contactUserId: string): Promise<boolean> => {
    const [row] = await this.db
      .select({ id: userContacts.id })
      .from(userContacts)
      .where(
        and(
          this.userEntryWhere(),
          eq(userContacts.userId, this.userId),
          eq(userContacts.contactUserId, contactUserId),
        ),
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

  /**
   * People the caller can talk to one-on-one in this scope, the ones a conversation between two
   * people opens with: personal contacts; in a workspace, its other members, then the external
   * contacts paired with the caller; for an external contact, the members paired with them.
   * `query` narrows by a case-insensitive part of the display name or @handle.
   */
  listPeople = async (options: {
    limit: number;
    query?: string;
  }): Promise<{ hasMore: boolean; people: ContactUserProfile[] }> => {
    const role = await this.scopeRole();
    // A handle is matched without its `@`.
    const query = options.query?.trim().replace(/^@/, '').toLowerCase() || undefined;
    const matches = (person: ContactUserProfile) =>
      !query ||
      [person.fullName, person.username].some((value) => value?.toLowerCase().includes(query));

    const contacts =
      role === 'member'
        ? (await this.listExternals()).filter((item) => item.external?.openedToMe)
        : await this.listOwnPeople(role);
    const members =
      role === 'member'
        ? await this.db
            .select(userProfileColumns)
            .from(workspaceMembers)
            .innerJoin(users, eq(users.id, workspaceMembers.userId))
            .where(
              and(
                eq(workspaceMembers.workspaceId, this.workspaceId!),
                isNull(workspaceMembers.deletedAt),
                not(eq(workspaceMembers.userId, this.userId)),
                query
                  ? or(ilikeContains(users.fullName, query), ilikeContains(users.username, query))
                  : undefined,
              ),
            )
            .orderBy(users.fullName, users.username)
            // One more than asked tells whether more matched.
            .limit(options.limit + 1)
        : [];

    const people = [...members, ...contacts.map((item) => item.user).filter(matches)];
    return { hasMore: people.length > options.limit, people: people.slice(0, options.limit) };
  };

  /**
   * Everyone in this scope's address book except the caller: personal contacts; in a workspace,
   * its other members and every external contact of it, whoever invited them. Unlike
   * {@link listPeople} this ignores who the caller is in the scope, because it answers for a
   * resource the scope owns (an Agent's share), not for the caller's own conversations.
   */
  listAddressBookPeople = async (): Promise<ContactUserProfile[]> => {
    if (!this.workspaceId) {
      const rows = await this.db
        .select(userProfileColumns)
        .from(userContacts)
        .innerJoin(users, eq(users.id, userContacts.contactUserId))
        .where(and(this.userEntryWhere(), eq(userContacts.userId, this.userId)))
        .orderBy(desc(userContacts.createdAt));
      return rows;
    }

    const [members, externals] = await Promise.all([
      this.db
        .select(userProfileColumns)
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, this.workspaceId),
            isNull(workspaceMembers.deletedAt),
            not(eq(workspaceMembers.userId, this.userId)),
          ),
        )
        .orderBy(users.fullName, users.username),
      this.listExternals(),
    ]);
    return [...members, ...externals.map((item) => item.user)];
  };

  /**
   * The subset of `userIds` that {@link listAddressBookPeople} would list, without loading it:
   * the check an access grant re-runs on every use, so removing someone from the address book
   * (or from the workspace) ends what was granted to them.
   */
  filterAddressBookPeople = async (userIds: string[]): Promise<string[]> => {
    const candidates = [...new Set(userIds)].filter((id) => id !== this.userId);
    if (candidates.length === 0) return [];

    const entries = await this.db
      .select({ userId: userContacts.contactUserId })
      .from(userContacts)
      .where(
        and(
          this.userEntryWhere(),
          inArray(userContacts.contactUserId, candidates),
          // Personal: my own entries. Workspace: any member's external contact; the paired
          // member side of the same pair is a member, matched below instead.
          this.workspaceId ? not(this.contactIsMember()) : eq(userContacts.userId, this.userId),
        ),
      );
    const members = this.workspaceId
      ? await this.db
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, this.workspaceId),
              isNull(workspaceMembers.deletedAt),
              inArray(workspaceMembers.userId, candidates),
            ),
          )
      : [];

    const found = new Set([...entries, ...members].map((row) => row.userId));
    return candidates.filter((id) => found.has(id));
  };

  relationTo = async (otherUserId: string): Promise<ContactRelation> => {
    if (otherUserId === this.userId) return 'self';
    if ((await this.scopeRole()) === 'member' && (await this.isMember(otherUserId)))
      return 'member';
    if (await this.isContact(otherUserId)) return 'contact';
    const [pending] = await this.db
      .select({ requesterId: userContactRequests.requesterId })
      .from(userContactRequests)
      .where(
        and(
          eq(userContactRequests.status, 'pending'),
          this.requestScopeWhere(),
          this.pairWhere(otherUserId),
        ),
      )
      .limit(1);
    if (!pending) return 'none';
    return pending.requesterId === this.userId ? 'request_sent' : 'request_received';
  };

  /**
   * Ask `addresseeId` to become mutual contacts. Repeating a pending request returns it; a
   * personal request sent while theirs is pending accepts theirs instead. In a workspace only a
   * member asks, and only someone outside it: it invites them to be its external contact.
   */
  sendRequest = async (
    addresseeId: string,
    message?: string,
    options?: { cardMessageId?: string },
  ): Promise<{ requestId: string; status: 'accepted' | 'pending' }> => {
    if (addresseeId === this.userId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot add yourself' });
    const role = await this.scopeRole();
    if (role === 'external')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only members add contacts here' });
    if (role === 'member' && (await this.isMember(addresseeId)))
      throw new TRPCError({ code: 'CONFLICT', message: 'Already a member of this workspace' });

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
          and(
            this.userEntryWhere(),
            eq(userContacts.userId, this.userId),
            eq(userContacts.contactUserId, addresseeId),
          ),
        )
        .limit(1);
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Already a contact' });

      const [pending] = await tx
        .select({ id: userContactRequests.id, requesterId: userContactRequests.requesterId })
        .from(userContactRequests)
        .where(
          and(
            eq(userContactRequests.status, 'pending'),
            this.requestScopeWhere(),
            this.pairWhere(addresseeId),
          ),
        )
        .limit(1);
      if (pending?.requesterId === this.userId) return { requestId: pending.id, status: 'pending' };
      // Their pending request is answered by mine, unless they withdrew it meanwhile; then mine
      // goes out as a new request.
      if (pending && (await this.accept(tx, pending.id, addresseeId, this.workspaceId)))
        return { requestId: pending.id, status: 'accepted' };

      const source = options?.cardMessageId
        ? await this.cardSource(tx, options.cardMessageId, addresseeId)
        : undefined;
      const [created] = await tx
        .insert(userContactRequests)
        .values({
          addresseeId,
          message: message?.trim() || null,
          requesterId: this.userId,
          source: source ?? null,
          workspaceId: this.workspaceId,
        })
        .returning({ id: userContactRequests.id });
      return { requestId: created.id, status: 'pending' };
    });
  };

  /**
   * Pending requests of this scope. The personal space has personal requests both ways plus the
   * invitations members sent me from their workspaces, which I answer there before I can enter
   * the workspace. A member sees the invitations they sent from this workspace; an external
   * contact sees none.
   */
  listRequests = async (): Promise<ContactRequestItem[]> => {
    const role = await this.scopeRole();
    if (role === 'external') return [];
    const scope =
      role === 'member'
        ? and(this.requestScopeWhere(), eq(userContactRequests.requesterId, this.userId))
        : or(
            and(
              this.requestScopeWhere(),
              or(
                eq(userContactRequests.requesterId, this.userId),
                eq(userContactRequests.addresseeId, this.userId),
              ),
            ),
            and(
              isNotNull(userContactRequests.workspaceId),
              eq(userContactRequests.addresseeId, this.userId),
            ),
          );
    const rows = await this.db
      .select({
        createdAt: userContactRequests.createdAt,
        id: userContactRequests.id,
        message: userContactRequests.message,
        // Flat: drizzle drops a nested object of this aliased join.
        referrerAvatar: referrers.avatar,
        referrerFullName: referrers.fullName,
        referrerId: referrers.id,
        referrerUsername: referrers.username,
        requesterId: userContactRequests.requesterId,
        source: userContactRequests.source,
        user: userProfileColumns,
        workspaceAvatar: workspaces.avatar,
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
      })
      .from(userContactRequests)
      .innerJoin(
        users,
        sql`${users.id} = CASE WHEN ${userContactRequests.requesterId} = ${this.userId} THEN ${userContactRequests.addresseeId} ELSE ${userContactRequests.requesterId} END`,
      )
      .leftJoin(workspaces, eq(workspaces.id, userContactRequests.workspaceId))
      .leftJoin(
        referrers,
        eq(referrers.id, sql<string>`${userContactRequests.source} ->> 'referrerId'`),
      )
      .where(and(eq(userContactRequests.status, 'pending'), scope))
      .orderBy(desc(userContactRequests.createdAt));

    return rows.map((row) => ({
      createdAt: row.createdAt,
      direction: row.requesterId === this.userId ? 'outgoing' : 'incoming',
      id: row.id,
      message: row.message,
      source:
        row.source?.type === 'card'
          ? {
              referrer: row.referrerId
                ? {
                    avatar: row.referrerAvatar,
                    fullName: row.referrerFullName,
                    id: row.referrerId,
                    username: row.referrerUsername,
                  }
                : null,
              type: 'card' as const,
            }
          : null,
      user: row.user,
      workspace: row.workspaceId
        ? { avatar: row.workspaceAvatar, id: row.workspaceId, name: row.workspaceName ?? '' }
        : null,
    }));
  };

  /**
   * Accept a pending request sent to me; both people become each other's contact in the
   * request's scope. Accepting a member's invitation makes me an external contact of their
   * workspace, paired with them; it lapses once they leave it.
   */
  acceptRequest = async (
    requestId: string,
  ): Promise<{ contactUserId: string; workspaceId: string | null }> =>
    this.db.transaction(async (tx) => {
      const request = await this.incomingPending(tx, requestId);
      const { requesterId, workspaceId } = request;
      if (workspaceId) {
        const members = await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              inArray(workspaceMembers.userId, [requesterId, this.userId]),
              isNull(workspaceMembers.deletedAt),
            ),
          );
        if (!members.some((member) => member.userId === requesterId))
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
        if (members.some((member) => member.userId === this.userId))
          throw new TRPCError({ code: 'CONFLICT', message: 'Already a member of this workspace' });
      }
      await this.lockPair(tx, requesterId, workspaceId);
      if (!(await this.accept(tx, request.id, requesterId, workspaceId)))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      return { contactUserId: requesterId, workspaceId };
    });

  /** Returns who sent it, so they can be told their request is no longer pending. */
  declineRequest = async (requestId: string): Promise<{ requesterId: string }> =>
    this.db.transaction(async (tx) => {
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
      return { requesterId: request.requesterId };
    });

  /** Returns who it was sent to, so their incoming request can disappear. */
  cancelRequest = async (requestId: string): Promise<{ addresseeId: string }> => {
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
      .returning({ addresseeId: userContactRequests.addresseeId });
    if (!cancelled) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    return { addresseeId: cancelled.addresseeId };
  };

  /**
   * Remove a person from my contacts in this scope; the relation is mutual, so both entries go.
   * A member closes themselves to an external contact this way, and an external contact drops a
   * member; once an external contact has no member left, the workspace is gone for them.
   */
  removeUser = async (contactUserId: string) => {
    await this.scopeRole();
    await this.db
      .delete(userContacts)
      .where(and(this.userEntryWhere(), this.entryPairWhere(contactUserId)));
  };

  /**
   * A member opens themselves to an external contact of the workspace, who can then see and
   * message them. Each member opens only themselves; the inviter is paired on accepting.
   */
  openTo = async (externalUserId: string) => {
    if ((await this.scopeRole()) !== 'member')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only members open themselves' });
    if (externalUserId === this.userId || !(await this.isExternal(externalUserId)))
      throw new TRPCError({ code: 'NOT_FOUND', message: 'External contact not found' });
    await this.db
      .insert(userContacts)
      .values([
        {
          contactUserId: externalUserId,
          type: 'user',
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
        {
          contactUserId: this.userId,
          type: 'user',
          userId: externalUserId,
          workspaceId: this.workspaceId,
        },
      ])
      .onConflictDoNothing();
  };

  /**
   * An owner or admin removes an external contact from the workspace: every pairing goes, and
   * so do the invitations still pending for them.
   */
  removeExternal = async (externalUserId: string) => {
    if ((await this.scopeRole()) !== 'member' || !(await this.isManager()))
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only owners and admins remove them' });
    if (!(await this.isExternal(externalUserId)))
      throw new TRPCError({ code: 'NOT_FOUND', message: 'External contact not found' });
    await this.db.transaction(async (tx) => {
      await tx
        .delete(userContacts)
        .where(
          and(
            this.userEntryWhere(),
            or(
              eq(userContacts.userId, externalUserId),
              eq(userContacts.contactUserId, externalUserId),
            ),
          ),
        );
      await tx
        .update(userContactRequests)
        .set({ respondedAt: new Date(), status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            this.requestScopeWhere(),
            eq(userContactRequests.addresseeId, externalUserId),
            eq(userContactRequests.status, 'pending'),
          ),
        );
    });
  };

  /**
   * The workspaces I am an external contact of, for the space switcher: paired there with a
   * member who still is one, and not a member myself. Independent of the active scope.
   */
  listExternalWorkspaces = async (): Promise<ContactWorkspace[]> => {
    const myMembership = alias(workspaceMembers, 'my_membership');
    return this.db
      .selectDistinct({ avatar: workspaces.avatar, id: workspaces.id, name: workspaces.name })
      .from(userContacts)
      .innerJoin(workspaces, eq(workspaces.id, userContacts.workspaceId))
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, userContacts.workspaceId),
          eq(workspaceMembers.userId, userContacts.contactUserId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .leftJoin(
        myMembership,
        and(
          eq(myMembership.workspaceId, userContacts.workspaceId),
          eq(myMembership.userId, this.userId),
          isNull(myMembership.deletedAt),
        ),
      )
      .where(
        and(
          eq(userContacts.userId, this.userId),
          eq(userContacts.type, 'user'),
          isNotNull(userContacts.workspaceId),
          isNull(myMembership.userId),
        ),
      )
      .orderBy(workspaces.name);
  };

  /** Someone paired with a member here who is not a member themselves. */
  private async isExternal(userId: string) {
    if (await this.isMember(userId)) return false;
    const [entry] = await this.db
      .select({ id: userContacts.id })
      .from(userContacts)
      .where(and(this.userEntryWhere(), eq(userContacts.userId, userId)))
      .limit(1);
    return !!entry;
  }

  private async isManager() {
    const [row] = await this.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(activeMemberWhere(this.workspaceId!, this.userId))
      .limit(1);
    return !!row && WORKSPACE_MANAGER_ROLES.includes(row.role);
  }

  private entryPairWhere(otherUserId: string) {
    return or(
      and(eq(userContacts.userId, this.userId), eq(userContacts.contactUserId, otherUserId)),
      and(eq(userContacts.userId, otherUserId), eq(userContacts.contactUserId, this.userId)),
    );
  }

  /**
   * The source of a request sent from a person's card: only when the card message stands in a
   * Channel I am an active member of and shares exactly the addressee. Anything else is dropped,
   * not refused: the request itself does not depend on its source.
   */
  private cardSource = async (
    tx: Pick<LobeChatDatabase, 'select'>,
    messageId: string,
    addresseeId: string,
  ): Promise<ContactRequestSource | undefined> => {
    const found = await this.findCardMessage(tx, messageId);
    if (found?.card.type !== 'user' || found.card.userId !== addresseeId) return;
    return { channelId: found.channelId, messageId, referrerId: found.senderId, type: 'card' };
  };

  /** A live card message in a Channel I am an active member of, with its card. */
  private findCardMessage = async (tx: Pick<LobeChatDatabase, 'select'>, messageId: string) => {
    if (!isUuid(messageId)) return;
    const [row] = await tx
      .select({
        channelId: channelMessages.channelId,
        createdAt: channelMessages.createdAt,
        metadata: channelMessages.metadata,
        senderId: channelMessages.userId,
      })
      .from(channelMessages)
      .innerJoin(
        channelMembers,
        and(
          eq(channelMembers.channelId, channelMessages.channelId),
          eq(channelMembers.userId, this.userId),
          eq(channelMembers.status, 'active'),
        ),
      )
      .where(eq(channelMessages.id, messageId))
      .limit(1);
    const card = contactCardOf(row?.metadata);
    if (!row || !card || channelMessageDeletedAt(row.metadata)) return;
    return { ...row, card };
  };

  /**
   * A contact the caller may share as a card, with its snapshot. A person: the caller, one of
   * their contacts, or a fellow member of the workspace. An Agent: its owner may share it while
   * its share is `card` or `link`, and anyone may pass on a `link` share, since anyone signed in
   * can add it anyway. Only the owner's card admits people to a `card` share. An owner whose
   * share is off is told to turn card sharing on (`agentShare.enableCardShare`), never refused
   * outright, so a client can do that and send in one step.
   */
  resolveCard = async (input: ContactCardInput): Promise<ContactCard> => {
    if ((await this.scopeRole()) === 'external')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only members share contacts here' });

    if (input.type === 'user') {
      const relation = await this.relationTo(input.userId);
      if (relation !== 'self' && relation !== 'contact' && relation !== 'member')
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Share only your contacts' });
      const user = await this.findUser(input.userId);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      return {
        avatar: user.avatar,
        name: user.fullName || user.username,
        type: 'user',
        userId: user.id,
        username: user.username,
      };
    }

    const [row] = await this.db
      .select(agentProfileColumns)
      .from(agents)
      .leftJoin(agentShares, eq(agentShares.agentId, agents.id))
      .leftJoin(owners, eq(owners.id, agents.userId))
      .where(and(eq(agents.id, input.agentId), notTrashed(agents.isDeleted)))
      .limit(1);
    const isOwner = !!row && row.ownerId === this.userId;
    const shareable =
      row?.shareId && (row.visibility === 'link' || (row.visibility === 'card' && isOwner));
    if (!shareable) {
      if (isOwner)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Turn on sharing first' });
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
    }
    const profile = toAgentProfile({ ...row, shareId: row.shareId! });
    return {
      agentId: profile.agentId,
      avatar: profile.avatar,
      backgroundColor: profile.backgroundColor,
      // The name every list shows: the personal name, else the role title.
      name: agentDisplayName(profile) ?? null,
      ownerName: profile.owner.fullName || profile.owner.username,
      shareId: profile.shareId,
      type: 'agent',
    };
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

  /**
   * Add another person's Agent from its card in a Channel I am an active member of. A card its
   * owner sent also grants me its share, which is what admits me to a `card` share and keeps me
   * admitted if a `link` share later becomes `card`; a card anyone else passed on only works while
   * the share is `link`, like the link itself.
   */
  addAgentFromCard = async (messageId: string): Promise<ContactAgentProfile> => {
    if ((await this.scopeRole()) === 'external')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only members add Agents here' });
    const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
    const message = await this.findCardMessage(this.db, messageId);
    const card = message?.card;
    if (!message || card?.type !== 'agent') throw notFound();

    const [share] = await this.db
      .select(agentProfileColumns)
      .from(agentShares)
      .innerJoin(agents, eq(agents.id, agentShares.agentId))
      .leftJoin(owners, eq(owners.id, agents.userId))
      .where(
        and(
          eq(agentShares.id, card.shareId),
          eq(agents.id, card.agentId),
          notTrashed(agents.isDeleted),
        ),
      )
      .limit(1);
    if (!share?.ownerId) throw notFound();
    if (share.ownerId === this.userId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This Agent is already yours' });
    const fromOwner = message.senderId === share.ownerId;
    if (!(share.visibility === 'link' || (share.visibility === 'card' && fromOwner)))
      throw notFound();

    await this.db.transaction(async (tx) => {
      const granted =
        fromOwner &&
        (await AgentShareModel.grant(tx, {
          issuedAt: message.createdAt,
          shareId: share.shareId,
          source: { channelId: message.channelId, messageId, type: 'card' },
          userId: this.userId,
        }));
      // The owner revoked me after sending this card: it no longer admits me to a `card` share.
      if (share.visibility === 'card' && !granted) throw notFound();
      await tx
        .insert(userContacts)
        .values({
          agentId: share.agentId,
          type: 'agent',
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .onConflictDoNothing();
    });
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
    if ((await this.scopeRole()) === 'external') return undefined;
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
          agentShareAdmits(this.userId),
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
    // An external contact finds nothing of the workspace by searching.
    if (!handle || (await this.scopeRole()) === 'external') return [];
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

  /** Transaction-scoped advisory lock on the unordered pair in one scope. */
  private async lockPair(
    tx: Pick<LobeChatDatabase, 'execute'>,
    otherUserId: string,
    workspaceId: string | null = this.workspaceId,
  ) {
    const [a, b] = [this.userId, otherUserId].sort();
    const key = `contact:${workspaceId ?? 'personal'}:${a}:${b}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  }

  private async incomingPending(tx: Pick<LobeChatDatabase, 'select'>, requestId: string) {
    if (!isUuid(requestId))
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    const [request] = await tx
      .select({
        id: userContactRequests.id,
        requesterId: userContactRequests.requesterId,
        workspaceId: userContactRequests.workspaceId,
      })
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
    workspaceId: string | null,
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
        { contactUserId: requesterId, type: 'user', userId: this.userId, workspaceId },
        { contactUserId: this.userId, type: 'user', userId: requesterId, workspaceId },
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
