import type { ArtboardContent, ArtboardPhase } from '@lobechat/types';
import { and, desc, eq, exists, sql } from 'drizzle-orm';

import { type ArtboardRow, artboards } from '../schemas/artboard';
import { tasks } from '../schemas/task';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export class ArtboardRevisionConflictError extends Error {
  constructor() {
    super('Artboard changed; read it again before writing');
  }
}

export interface CreateArtboardParams {
  content: ArtboardContent;
  description?: string | null;
  originTopicId?: string | null;
  projectId?: string | null;
  taskId: string;
  title: string;
}

export interface UpdateArtboardParams {
  acceptanceId?: string | null;
  content?: ArtboardContent;
  expectedRevision: number;
  phase?: ArtboardPhase;
  title?: string;
}

type Database = LobeChatDatabase | Transaction;

export class ArtboardModel {
  constructor(
    private db: Database,
    private userId: string,
    private workspaceId?: string,
  ) {}

  withTransaction = (tx: Transaction) => new ArtboardModel(tx, this.userId, this.workspaceId);

  private scope = () => {
    const context = { userId: this.userId, workspaceId: this.workspaceId };
    return and(
      buildWorkspaceWhere(context, artboards),
      exists(
        this.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.id, artboards.taskId),
              buildWorkspaceWhere(context, {
                isDeleted: tasks.isDeleted,
                userId: tasks.createdByUserId,
                visibility: tasks.visibility,
                workspaceId: tasks.workspaceId,
              }),
            ),
          ),
      ),
    );
  };

  create = async (params: CreateArtboardParams): Promise<ArtboardRow> => {
    const [row] = await this.db
      .insert(artboards)
      .values({
        content: params.content,
        description: params.description ?? null,
        originTopicId: params.originTopicId ?? null,
        projectId: params.projectId ?? null,
        taskId: params.taskId,
        title: params.title,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .returning();
    return row;
  };

  findById = async (id: string): Promise<ArtboardRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(artboards)
      .where(and(eq(artboards.id, id), this.scope()))
      .limit(1);
    return row;
  };

  findByTaskId = async (taskId: string): Promise<ArtboardRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(artboards)
      .where(and(eq(artboards.taskId, taskId), this.scope()))
      .limit(1);
    return row;
  };

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
