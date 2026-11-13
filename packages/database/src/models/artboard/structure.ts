import { and, asc, count, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import {
  artboardBoards,
  artboardComments,
  artboardEdges,
  artboardGroups,
  artboardPages,
  artboardRounds,
  artboards,
} from '../../schemas/artboard';
import type { Transaction } from '../../type';
import { accessibleArtboardIds, type ArtboardDatabase } from './index';
import type {
  ArtboardBoardRow,
  ArtboardEdgeRow,
  ArtboardGroupRow,
  ArtboardPageRow,
  ArtboardRoundRow,
  NewArtboardBoardRow,
  NewArtboardEdgeRow,
  NewArtboardGroupRow,
  NewArtboardPageRow,
  NewArtboardRoundRow,
} from './types';

export type ArtboardStructureErrorCode =
  'invalid' | 'last_page' | 'missing_choice' | 'not_empty' | 'not_found' | 'round_submitted';

export class ArtboardStructureError extends Error {
  constructor(
    public code: ArtboardStructureErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: ArtboardStructureErrorCode, message: string): never => {
  throw new ArtboardStructureError(code, message);
};

// now() is frozen for a whole transaction, so a batch of rows would tie on created_at and read
// back in random order.
const writtenAt = sql`clock_timestamp()`;

type Scoped = 'artboardId' | 'createdAt' | 'id' | 'updatedAt' | 'userId' | 'workspaceId';

export type CreatePageParams = Omit<NewArtboardPageRow, Scoped>;
export type CreateRoundParams = Pick<NewArtboardRoundRow, 'metadata' | 'pageId' | 'title'>;
export type UpdateRoundParams = Partial<
  Pick<NewArtboardRoundRow, 'metadata' | 'recommendedBoardId' | 'title'>
>;
export type CreateGroupParams = Omit<NewArtboardGroupRow, Scoped>;
export type CreateBoardParams = Omit<NewArtboardBoardRow, Scoped>;
export type CreateEdgeParams = Omit<NewArtboardEdgeRow, Scoped>;

export interface ArtboardStructure {
  boards: ArtboardBoardRow[];
  edges: ArtboardEdgeRow[];
  groups: ArtboardGroupRow[];
  pages: ArtboardPageRow[];
  rounds: ArtboardRoundRow[];
}

type ChildTable =
  | typeof artboardBoards
  | typeof artboardEdges
  | typeof artboardGroups
  | typeof artboardPages
  | typeof artboardRounds;

export class ArtboardStructureModel {
  constructor(
    private db: ArtboardDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  withTransaction = (tx: Transaction) =>
    new ArtboardStructureModel(tx, this.userId, this.workspaceId);

  private accessible = () =>
    accessibleArtboardIds(this.db, { userId: this.userId, workspaceId: this.workspaceId });

  private reachable = (table: ChildTable) => inArray(table.artboardId, this.accessible());

  private ownerOf = async (artboardId: string) => {
    const [row] = await this.db
      .select({ userId: artboards.userId, workspaceId: artboards.workspaceId })
      .from(artboards)
      .where(and(eq(artboards.id, artboardId), inArray(artboards.id, this.accessible())))
      .limit(1);
    return row ?? fail('not_found', `No artboard ${artboardId}`);
  };

  private assertWithin = async (
    table: ChildTable,
    artboardId: string,
    ids: (string | null | undefined)[],
  ) => {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return;
    const [row] = await this.db
      .select({ total: count() })
      .from(table)
      .where(and(eq(table.artboardId, artboardId), inArray(table.id, wanted)));
    if (row.total !== wanted.length) fail('not_found', 'A referenced item is not on this artboard');
  };

  private assertBoardPlacement = async (
    artboardId: string,
    pageId: string | undefined,
    refs: { groupId?: string | null; roundId?: string | null },
  ) => {
    await this.assertWithin(artboardPages, artboardId, [pageId]);
    await this.assertWithin(artboardGroups, artboardId, [refs.groupId]);
    await this.assertWithin(artboardRounds, artboardId, [refs.roundId]);
    if (!pageId) return;
    for (const [table, id] of [
      [artboardGroups, refs.groupId],
      [artboardRounds, refs.roundId],
    ] as const) {
      if (!id) continue;
      const [row] = await this.db
        .select({ pageId: table.pageId })
        .from(table)
        .where(eq(table.id, id))
        .limit(1);
      if (row.pageId !== pageId)
        fail('invalid', 'A board must be on the page of its group and round');
    }
  };

  private holds = async (table: ChildTable, where: ReturnType<typeof eq>) => {
    const [row] = await this.db.select({ id: table.id }).from(table).where(where).limit(1);
    return !!row;
  };

  getStructure = async (artboardId: string): Promise<ArtboardStructure | undefined> => {
    const of = <T extends ChildTable>(table: T) =>
      and(eq(table.artboardId, artboardId), this.reachable(table));

    const pages = await this.db
      .select()
      .from(artboardPages)
      .where(of(artboardPages))
      .orderBy(asc(artboardPages.sortOrder), asc(artboardPages.createdAt));
    if (pages.length === 0) return undefined;

    const [rounds, groups, boards, edges] = await Promise.all([
      this.db
        .select()
        .from(artboardRounds)
        .where(of(artboardRounds))
        .orderBy(asc(artboardRounds.createdAt)),
      this.db
        .select()
        .from(artboardGroups)
        .where(of(artboardGroups))
        .orderBy(asc(artboardGroups.createdAt)),
      this.db
        .select()
        .from(artboardBoards)
        .where(of(artboardBoards))
        .orderBy(asc(artboardBoards.createdAt), asc(artboardBoards.id)),
      this.db
        .select()
        .from(artboardEdges)
        .where(of(artboardEdges))
        .orderBy(asc(artboardEdges.createdAt)),
    ]);
    return { boards, edges, groups, pages, rounds };
  };

  createPage = async (artboardId: string, params: CreatePageParams) => {
    const owner = await this.ownerOf(artboardId);
    const [row] = await this.db
      .insert(artboardPages)
      .values({ ...params, ...owner, artboardId, createdAt: writtenAt })
      .returning();
    return row;
  };

  updatePage = async (id: string, patch: Partial<CreatePageParams>) => {
    const [row] = await this.db
      .update(artboardPages)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(artboardPages.id, id), this.reachable(artboardPages)))
      .returning();
    return row ?? fail('not_found', `No page ${id}`);
  };

  deletePage = async (id: string) => {
    const [page] = await this.db
      .select()
      .from(artboardPages)
      .where(and(eq(artboardPages.id, id), this.reachable(artboardPages)))
      .limit(1);
    if (!page) return fail('not_found', `No page ${id}`);

    const occupied =
      (await this.holds(artboardBoards, eq(artboardBoards.pageId, id))) ||
      (await this.holds(artboardGroups, eq(artboardGroups.pageId, id))) ||
      (await this.holds(artboardRounds, eq(artboardRounds.pageId, id)));
    if (occupied) fail('not_empty', `Page ${id} still has content`);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(artboardPages)
      .where(eq(artboardPages.artboardId, page.artboardId));
    if (total <= 1) fail('last_page', 'An artboard keeps at least one page');

    await this.db.transaction(async (tx) => {
      await tx.delete(artboardComments).where(eq(artboardComments.pageId, id));
      await tx.delete(artboardPages).where(eq(artboardPages.id, id));
    });
  };

  createRound = async (artboardId: string, params: CreateRoundParams) => {
    const owner = await this.ownerOf(artboardId);
    await this.assertWithin(artboardPages, artboardId, [params.pageId]);
    const [row] = await this.db
      .insert(artboardRounds)
      .values({ ...params, ...owner, artboardId, createdAt: writtenAt })
      .returning();
    return row;
  };

  updateRound = async (id: string, patch: UpdateRoundParams) => {
    const [current] = await this.db
      .select({ status: artboardRounds.status })
      .from(artboardRounds)
      .where(and(eq(artboardRounds.id, id), this.reachable(artboardRounds)))
      .limit(1);
    if (!current) return fail('not_found', `No round ${id}`);
    if (current.status !== 'open') fail('round_submitted', `Round ${id} is already submitted`);
    if (patch.recommendedBoardId) {
      const [option] = await this.db
        .select({ id: artboardBoards.id })
        .from(artboardBoards)
        .where(and(eq(artboardBoards.id, patch.recommendedBoardId), eq(artboardBoards.roundId, id)))
        .limit(1);
      if (!option) fail('not_found', `Board ${patch.recommendedBoardId} is not an option of ${id}`);
    }

    const [row] = await this.db
      .update(artboardRounds)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(artboardRounds.id, id))
      .returning();
    return row;
  };

  createGroup = async (artboardId: string, params: CreateGroupParams) => {
    const owner = await this.ownerOf(artboardId);
    await this.assertWithin(artboardPages, artboardId, [params.pageId]);
    const [row] = await this.db
      .insert(artboardGroups)
      .values({ ...params, ...owner, artboardId, createdAt: writtenAt })
      .returning();
    return row;
  };

  updateGroup = async (id: string, patch: Partial<CreateGroupParams>) => {
    const [current] = await this.db
      .select({ artboardId: artboardGroups.artboardId })
      .from(artboardGroups)
      .where(and(eq(artboardGroups.id, id), this.reachable(artboardGroups)))
      .limit(1);
    if (!current) return fail('not_found', `No group ${id}`);
    await this.assertWithin(artboardPages, current.artboardId, [patch.pageId]);

    const [row] = await this.db
      .update(artboardGroups)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(artboardGroups.id, id))
      .returning();
    return row;
  };

  deleteGroup = async (id: string) => {
    const reachable = await this.holds(
      artboardGroups,
      and(eq(artboardGroups.id, id), this.reachable(artboardGroups))!,
    );
    if (!reachable) fail('not_found', `No group ${id}`);
    if (await this.holds(artboardBoards, eq(artboardBoards.groupId, id)))
      fail('not_empty', `Group ${id} still has boards`);
    await this.db.delete(artboardGroups).where(eq(artboardGroups.id, id));
  };

  createBoard = async (artboardId: string, params: CreateBoardParams) => {
    const owner = await this.ownerOf(artboardId);
    await this.assertBoardPlacement(artboardId, params.pageId, params);
    const [row] = await this.db
      .insert(artboardBoards)
      .values({ ...params, ...owner, artboardId, createdAt: writtenAt })
      .returning();
    return row;
  };

  updateBoard = async (id: string, patch: Partial<CreateBoardParams>) => {
    const [current] = await this.db
      .select()
      .from(artboardBoards)
      .where(and(eq(artboardBoards.id, id), this.reachable(artboardBoards)))
      .limit(1);
    if (!current) return fail('not_found', `No board ${id}`);
    await this.assertBoardPlacement(current.artboardId, patch.pageId ?? current.pageId, {
      groupId: patch.groupId === undefined ? current.groupId : patch.groupId,
      roundId: patch.roundId === undefined ? current.roundId : patch.roundId,
    });

    const [row] = await this.db
      .update(artboardBoards)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(artboardBoards.id, id))
      .returning();
    return row;
  };

  deleteBoard = async (id: string) => {
    const [row] = await this.db
      .delete(artboardBoards)
      .where(and(eq(artboardBoards.id, id), this.reachable(artboardBoards)))
      .returning({ id: artboardBoards.id });
    if (!row) fail('not_found', `No board ${id}`);
  };

  createEdge = async (artboardId: string, params: CreateEdgeParams) => {
    const owner = await this.ownerOf(artboardId);
    await this.assertWithin(artboardBoards, artboardId, [
      params.sourceBoardId,
      params.targetBoardId,
    ]);
    const [row] = await this.db
      .insert(artboardEdges)
      .values({ ...params, ...owner, artboardId, createdAt: writtenAt })
      .returning();
    return row;
  };

  updateEdge = async (
    id: string,
    patch: Pick<
      Partial<CreateEdgeParams>,
      'acceptanceFlowEdgeId' | 'condition' | 'isDefault' | 'label' | 'metadata' | 'sortOrder'
    >,
  ) => {
    const [row] = await this.db
      .update(artboardEdges)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(artboardEdges.id, id), this.reachable(artboardEdges)))
      .returning();
    return row ?? fail('not_found', `No edge ${id}`);
  };

  deleteEdge = async (id: string) => {
    const [row] = await this.db
      .delete(artboardEdges)
      .where(and(eq(artboardEdges.id, id), this.reachable(artboardEdges)))
      .returning({ id: artboardEdges.id });
    if (!row) fail('not_found', `No edge ${id}`);
  };

  chooseBoard = (roundId: string, boardId: string): Promise<ArtboardRoundRow> =>
    this.db.transaction(async (tx) => {
      // Locks the round row so a concurrent submitRound cannot commit between this check and the write.
      const [round] = await tx
        .select({ status: artboardRounds.status })
        .from(artboardRounds)
        .where(
          and(
            eq(artboardRounds.id, roundId),
            inArray(
              artboardRounds.artboardId,
              accessibleArtboardIds(tx, { userId: this.userId, workspaceId: this.workspaceId }),
            ),
          ),
        )
        .for('update');
      if (!round) return fail('not_found', `No round ${roundId}`);
      if (round.status !== 'open')
        fail('round_submitted', 'The round is submitted; its choice is final');

      const [option] = await tx
        .select({ id: artboardBoards.id })
        .from(artboardBoards)
        .where(and(eq(artboardBoards.id, boardId), eq(artboardBoards.roundId, roundId)))
        .limit(1);
      if (!option) fail('not_found', `Board ${boardId} is not an option of round ${roundId}`);

      const now = new Date();
      const [row] = await tx
        .update(artboardRounds)
        .set({ chosenBoardId: boardId, selectedAt: now, selectedBy: this.userId, updatedAt: now })
        .where(eq(artboardRounds.id, roundId))
        .returning();
      return row;
    });

  submitRound = (roundId: string): Promise<ArtboardRoundRow[]> =>
    this.db.transaction(async (tx) => {
      const [round] = await tx
        .select()
        .from(artboardRounds)
        .where(
          and(
            eq(artboardRounds.id, roundId),
            inArray(
              artboardRounds.artboardId,
              accessibleArtboardIds(tx, { userId: this.userId, workspaceId: this.workspaceId }),
            ),
          ),
        )
        .for('update');
      if (!round) return fail('not_found', `No round ${roundId}`);
      if (round.status !== 'open') fail('round_submitted', `Round ${roundId} is already submitted`);

      const batchId = round.metadata?.batchId;
      const batch = and(
        eq(artboardRounds.artboardId, round.artboardId),
        eq(artboardRounds.status, 'open'),
        batchId
          ? sql`${artboardRounds.metadata}->>'batchId' = ${batchId}`
          : eq(artboardRounds.id, roundId),
      );
      const members = await tx.select().from(artboardRounds).where(batch).for('update');

      const undecided = members.find((item) => !item.chosenBoardId && !item.recommendedBoardId);
      if (undecided)
        fail('missing_choice', `Round ${undecided.id} has no pick and no recommendation`);

      const now = new Date();
      await tx
        .update(artboardRounds)
        .set({
          chosenBoardId: artboardRounds.recommendedBoardId,
          selectedAt: now,
          selectedBy: this.userId,
        })
        .where(and(batch, isNull(artboardRounds.chosenBoardId)));
      return tx
        .update(artboardRounds)
        .set({ status: 'submitted', updatedAt: now })
        .where(batch)
        .returning();
    });

  listBoardsByProject = (projectId: string): Promise<ArtboardBoardRow[]> =>
    this.db
      .select()
      .from(artboardBoards)
      .where(and(eq(artboardBoards.projectId, projectId), this.reachable(artboardBoards)))
      .orderBy(asc(artboardBoards.createdAt));

  findBoardByAcceptanceNode = async (nodeId: string): Promise<ArtboardBoardRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(artboardBoards)
      .where(and(eq(artboardBoards.acceptanceFlowNodeId, nodeId), this.reachable(artboardBoards)))
      .limit(1);
    return row;
  };

  listUndecidedRoundsByProject = async (projectId: string): Promise<ArtboardRoundRow[]> => {
    const rows = await this.db
      .select({ round: artboardRounds })
      .from(artboardRounds)
      .innerJoin(artboards, eq(artboards.id, artboardRounds.artboardId))
      .where(
        and(
          eq(artboards.projectId, projectId),
          or(isNull(artboardRounds.chosenBoardId), ne(artboardRounds.status, 'submitted')),
          this.reachable(artboardRounds),
        ),
      )
      .orderBy(asc(artboardRounds.createdAt));
    return rows.map((row) => row.round);
  };
}
