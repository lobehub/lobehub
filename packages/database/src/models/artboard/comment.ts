import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';

import {
  artboardBoards,
  artboardComments,
  artboardGroups,
  artboardPages,
  artboards,
} from '../../schemas/artboard';
import type { Transaction } from '../../type';
import { accessibleArtboardIds, type ArtboardDatabase } from './index';
import type { ArtboardCommentRow, NewArtboardCommentRow } from './types';

export type ArtboardCommentErrorCode = 'invalid' | 'not_found';

export class ArtboardCommentError extends Error {
  constructor(
    public code: ArtboardCommentErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: ArtboardCommentErrorCode, message: string): never => {
  throw new ArtboardCommentError(code, message);
};

export type CreateArtboardCommentParams = Pick<
  NewArtboardCommentRow,
  | 'anchor'
  | 'authorAgentId'
  | 'boardId'
  | 'clientId'
  | 'content'
  | 'groupId'
  | 'metadata'
  | 'pageId'
>;

export type ReplyArtboardCommentParams = Pick<
  NewArtboardCommentRow,
  'authorAgentId' | 'clientId' | 'content' | 'metadata'
>;

export interface ArtboardCommentThread {
  replies: ArtboardCommentRow[];
  root: ArtboardCommentRow;
}

type AnchorTable = typeof artboardBoards | typeof artboardGroups | typeof artboardPages;

export class ArtboardCommentModel {
  constructor(
    private db: ArtboardDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  withTransaction = (tx: Transaction) =>
    new ArtboardCommentModel(tx, this.userId, this.workspaceId);

  private reachable = () =>
    inArray(
      artboardComments.artboardId,
      accessibleArtboardIds(this.db, { userId: this.userId, workspaceId: this.workspaceId }),
    );

  private findArtboard = async (artboardId: string) => {
    const [row] = await this.db
      .select({
        id: artboards.id,
        userId: artboards.userId,
        workspaceId: artboards.workspaceId,
      })
      .from(artboards)
      .where(
        and(
          eq(artboards.id, artboardId),
          inArray(
            artboards.id,
            accessibleArtboardIds(this.db, { userId: this.userId, workspaceId: this.workspaceId }),
          ),
        ),
      )
      .limit(1);
    return row;
  };

  private assertAnchor = async (table: AnchorTable, artboardId: string, id?: string | null) => {
    if (!id) return;
    const [row] = await this.db
      .select({ total: count() })
      .from(table)
      .where(and(eq(table.artboardId, artboardId), eq(table.id, id)));
    if (row.total !== 1) fail('not_found', 'The comment anchor is not on this artboard');
  };

  private findReachable = async (id: string) => {
    const [row] = await this.db
      .select()
      .from(artboardComments)
      .where(and(eq(artboardComments.id, id), this.reachable()))
      .limit(1);
    return row ?? fail('not_found', `No comment ${id}`);
  };

  private insert = async (values: NewArtboardCommentRow): Promise<ArtboardCommentRow> => {
    const [created] = await this.db
      .insert(artboardComments)
      .values(values)
      .onConflictDoNothing({
        target: [
          artboardComments.artboardId,
          artboardComments.authorUserId,
          artboardComments.clientId,
        ],
      })
      .returning();
    if (created) return created;

    const [existing] = await this.db
      .select()
      .from(artboardComments)
      .where(
        and(
          eq(artboardComments.artboardId, values.artboardId),
          eq(artboardComments.authorUserId, this.userId),
          eq(artboardComments.clientId, values.clientId),
        ),
      )
      .limit(1);
    return existing;
  };

  create = async (
    artboardId: string,
    params: CreateArtboardCommentParams,
  ): Promise<ArtboardCommentRow> => {
    const artboard = await this.findArtboard(artboardId);
    if (!artboard) return fail('not_found', `No artboard ${artboardId}`);
    await this.assertAnchor(artboardPages, artboardId, params.pageId);
    await this.assertAnchor(artboardGroups, artboardId, params.groupId);
    await this.assertAnchor(artboardBoards, artboardId, params.boardId);

    return this.insert({
      ...params,
      artboardId,
      authorUserId: this.userId,
      userId: artboard.userId,
      workspaceId: artboard.workspaceId,
    });
  };

  reply = async (
    commentId: string,
    params: ReplyArtboardCommentParams,
  ): Promise<ArtboardCommentRow> => {
    const target = await this.findReachable(commentId);
    return this.insert({
      ...params,
      artboardId: target.artboardId,
      authorUserId: this.userId,
      pageId: target.pageId,
      parentCommentId: target.parentCommentId ?? target.id,
      userId: target.userId,
      workspaceId: target.workspaceId,
    });
  };

  private setResolved = async (rootId: string, resolved: boolean) => {
    const target = await this.findReachable(rootId);
    if (target.parentCommentId) fail('invalid', 'Only a thread root can be resolved');
    const [row] = await this.db
      .update(artboardComments)
      .set({
        resolvedAt: resolved ? new Date() : null,
        resolvedByUserId: resolved ? this.userId : null,
        updatedAt: new Date(),
      })
      .where(and(eq(artboardComments.id, rootId), isNull(artboardComments.parentCommentId)))
      .returning();
    return row;
  };

  resolve = (rootId: string) => this.setResolved(rootId, true);

  reopen = (rootId: string) => this.setResolved(rootId, false);

  listThreads = async (
    artboardId: string,
    options: { unresolvedOnly?: boolean } = {},
  ): Promise<ArtboardCommentThread[]> => {
    const rows = await this.db
      .select()
      .from(artboardComments)
      .where(and(eq(artboardComments.artboardId, artboardId), this.reachable()))
      .orderBy(asc(artboardComments.createdAt), asc(artboardComments.id));

    const threads = new Map<string, ArtboardCommentThread>();
    for (const row of rows) {
      if (!row.parentCommentId) threads.set(row.id, { replies: [], root: row });
    }
    for (const row of rows) {
      if (row.parentCommentId) threads.get(row.parentCommentId)?.replies.push(row);
    }
    const all = [...threads.values()];
    return options.unresolvedOnly ? all.filter((thread) => !thread.root.resolvedAt) : all;
  };

  listUndelivered = async (artboardId: string): Promise<ArtboardCommentThread[]> => {
    const open = await this.listThreads(artboardId, { unresolvedOnly: true });
    return open.filter((thread) =>
      [thread.root, ...thread.replies].some((message) => !message.deliveredAt),
    );
  };

  markDelivered = async (commentIds: string[], at: Date): Promise<void> => {
    if (commentIds.length === 0) return;
    await this.db
      .update(artboardComments)
      .set({ deliveredAt: at })
      .where(
        and(
          inArray(artboardComments.id, commentIds),
          isNull(artboardComments.deliveredAt),
          this.reachable(),
        ),
      );
  };
}
