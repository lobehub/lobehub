import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { ChannelSectionItem } from '../../schemas';
import { channelMembers, channelSections } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { ChannelError } from './error';

/**
 * A person's own sidebar sections in one scope (personal or a workspace). Channels are shared,
 * so how each member files them lives here and on their own member row, never on the channel.
 */
export class ChannelSectionRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId: string | null,
  ) {}

  /** The caller's sections in this scope, in sidebar order. */
  list = (): Promise<ChannelSectionItem[]> =>
    this.db
      .select()
      .from(channelSections)
      .where(this.ownedWhere())
      .orderBy(
        sql`${channelSections.sort} ASC NULLS LAST`,
        asc(channelSections.createdAt),
        asc(channelSections.id),
      );

  /** Adds a section after the existing ones. */
  create = (name: string): Promise<ChannelSectionItem> =>
    this.db.transaction(async (tx) => {
      const [{ last }] = await tx
        .select({ last: sql<number | null>`max(${channelSections.sort})` })
        .from(channelSections)
        .where(this.ownedWhere());
      const [section] = await tx
        .insert(channelSections)
        .values({
          name,
          sort: (last ?? -1) + 1,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .returning();
      return section;
    });

  update = async (
    id: string,
    value: { collapsed?: boolean; name?: string },
  ): Promise<ChannelSectionItem> => {
    const [section] = await this.db
      .update(channelSections)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(channelSections.id, id), this.ownedWhere()))
      .returning();
    if (!section) throw new ChannelError('NOT_FOUND', 'Section not found');
    return section;
  };

  /** Sets the order to `ids`; sections left out keep their own `sort`. */
  reorder = (ids: string[]): Promise<void> =>
    this.db.transaction(async (tx) => {
      await this.requireOwned(tx, ids);
      for (const [sort, id] of ids.entries())
        await tx
          .update(channelSections)
          .set({ sort, updatedAt: new Date() })
          .where(eq(channelSections.id, id));
    });

  /** Deletes a section; its conversations fall back to the built-in sections. */
  remove = async (id: string): Promise<void> => {
    const [removed] = await this.db
      .delete(channelSections)
      .where(and(eq(channelSections.id, id), this.ownedWhere()))
      .returning({ id: channelSections.id });
    if (!removed) throw new ChannelError('NOT_FOUND', 'Section not found');
  };

  /** Throws unless `sectionId` is one of the caller's sections in this scope. */
  assertOwned = async (tx: Transaction, sectionId: string): Promise<void> => {
    await this.requireOwned(tx, [sectionId]);
  };

  private requireOwned = async (tx: Transaction, ids: string[]): Promise<void> => {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const rows = await tx
      .select({ id: channelSections.id })
      .from(channelSections)
      .where(and(inArray(channelSections.id, unique), this.ownedWhere()));
    if (rows.length !== unique.length) throw new ChannelError('NOT_FOUND', 'Section not found');
  };

  private ownedWhere() {
    return and(
      eq(channelSections.userId, this.userId),
      this.workspaceId
        ? eq(channelSections.workspaceId, this.workspaceId)
        : isNull(channelSections.workspaceId),
    );
  }
}

/**
 * Brings a hidden conversation back into every member's list when a new message lands. The caller
 * holds the channel lock.
 */
export const unhideForActivity = async (tx: Transaction, channelId: string): Promise<void> => {
  await tx
    .update(channelMembers)
    .set({ hidden: false })
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.hidden, true)));
};
