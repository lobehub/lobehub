import { ARTBOARD_DEFAULT_PAGE_NAME, type ArtboardPhase } from '@lobechat/types';
import { and, desc, eq, exists, isNull, or, sql } from 'drizzle-orm';

import { artboardPages, artboards } from '../../schemas/artboard';
import { tasks } from '../../schemas/task';
import type { LobeChatDatabase, Transaction } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { ArtboardRow } from './types';

export type * from './types';

export type ArtboardDatabase = LobeChatDatabase | Transaction;

export interface ArtboardScope {
  userId: string;
  workspaceId?: string;
}

export class ArtboardRevisionConflictError extends Error {
  constructor() {
    super('Artboard changed; read it again before writing');
  }
}

export const artboardAccessWhere = (db: ArtboardDatabase, scope: ArtboardScope) =>
  and(
    buildWorkspaceWhere(scope, artboards),
    or(
      isNull(artboards.taskId),
      exists(
        db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.id, artboards.taskId),
              buildWorkspaceWhere(scope, {
                isDeleted: tasks.isDeleted,
                userId: tasks.createdByUserId,
                visibility: tasks.visibility,
                workspaceId: tasks.workspaceId,
              }),
            ),
          ),
      ),
    ),
  );

export const accessibleArtboardIds = (db: ArtboardDatabase, scope: ArtboardScope) =>
  db.select({ id: artboards.id }).from(artboards).where(artboardAccessWhere(db, scope));

export interface CreateArtboardParams {
  content?: string | null;
  description?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  title: string;
  topicId?: string | null;
}

export interface UpdateArtboardParams {
  acceptanceId?: string | null;
  content?: string | null;
  description?: string | null;
  expectedRevision: number;
  phase?: ArtboardPhase;
  title?: string;
}

export class ArtboardModel {
  constructor(
    private db: ArtboardDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  withTransaction = (tx: Transaction) => new ArtboardModel(tx, this.userId, this.workspaceId);

  private get owner() {
    return { userId: this.userId, workspaceId: this.workspaceId ?? null };
  }

  private scope = () =>
    artboardAccessWhere(this.db, { userId: this.userId, workspaceId: this.workspaceId });

  create = (params: CreateArtboardParams): Promise<ArtboardRow> =>
    this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(artboards)
        .values({
          ...this.owner,
          content: params.content ?? null,
          description: params.description ?? null,
          projectId: params.projectId ?? null,
          taskId: params.taskId ?? null,
          title: params.title,
          topicId: params.topicId ?? null,
        })
        .returning();
      await tx
        .insert(artboardPages)
        .values({ ...this.owner, artboardId: row.id, name: ARTBOARD_DEFAULT_PAGE_NAME });
      return row;
    });

  findById = async (id: string): Promise<ArtboardRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(artboards)
      .where(and(eq(artboards.id, id), this.scope()))
      .limit(1);
    return row;
  };

  listByTaskId = (taskId: string): Promise<ArtboardRow[]> =>
    this.db
      .select()
      .from(artboards)
      .where(and(eq(artboards.taskId, taskId), this.scope()))
      .orderBy(desc(artboards.updatedAt));

  listByProject = (projectId: string): Promise<ArtboardRow[]> =>
    this.db
      .select()
      .from(artboards)
      .where(and(eq(artboards.projectId, projectId), this.scope()))
      .orderBy(desc(artboards.updatedAt));

  getRevision = async (id: string): Promise<number | undefined> => {
    const [row] = await this.db
      .select({ revision: artboards.revision })
      .from(artboards)
      .where(and(eq(artboards.id, id), this.scope()))
      .limit(1);
    return row?.revision;
  };

  update = async (id: string, params: UpdateArtboardParams): Promise<ArtboardRow> => {
    const { expectedRevision, ...fields } = params;
    const [row] = await this.db
      .update(artboards)
      .set({ ...fields, revision: sql`${artboards.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(artboards.id, id), eq(artboards.revision, expectedRevision), this.scope()))
      .returning();
    if (!row) throw new ArtboardRevisionConflictError();
    return row;
  };
}
