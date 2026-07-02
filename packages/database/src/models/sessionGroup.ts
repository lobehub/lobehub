import { and, asc, desc, eq } from 'drizzle-orm';

import type { SessionGroupItem } from '../schemas';
import { sessionGroups } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class SessionGroupModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: sessionGroups.userId,
        workspaceId: sessionGroups.workspaceId,
        visibility: sessionGroups.visibility,
      },
    );

  create = async (params: { name: string; sort?: number; visibility?: 'private' | 'public' }) => {
    const [result] = await this.db
      .insert(sessionGroups)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...params, id: this.genId() },
        ),
      )
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.delete(sessionGroups).where(and(eq(sessionGroups.id, id), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(sessionGroups).where(this.ownership());
  };

  query = async () => {
    return this.db.query.sessionGroups.findMany({
      orderBy: [asc(sessionGroups.sort), desc(sessionGroups.createdAt)],
      where: this.ownership(),
    });
  };

  findById = async (id: string) => {
    return this.db.query.sessionGroups.findFirst({
      where: and(eq(sessionGroups.id, id), this.ownership()),
    });
  };

  update = async (id: string, value: Partial<SessionGroupItem>) => {
    return this.db
      .update(sessionGroups)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(sessionGroups.id, id), this.ownership()));
  };

  /**
   * Publish a private session group (folder) into the workspace. One-way:
   * mirrors the rule applied to agents and chat groups — a shared folder
   * can't be re-privatized because other members may already be relying on
   * it as a container for their bookmarks.
   */
  publishToWorkspace = async (id: string) => {
    return this.db
      .update(sessionGroups)
      .set({ updatedAt: new Date(), visibility: 'public' })
      .where(
        and(
          eq(sessionGroups.id, id),
          this.ownership(),
          eq(sessionGroups.userId, this.userId),
          eq(sessionGroups.visibility, 'private'),
        ),
      );
  };

  updateOrder = async (sortMap: { id: string; sort: number }[]) => {
    await this.db.transaction(async (tx) => {
      const updates = sortMap.map(({ id, sort }) => {
        return tx
          .update(sessionGroups)
          .set({ sort, updatedAt: new Date() })
          .where(and(eq(sessionGroups.id, id), this.ownership()));
      });

      await Promise.all(updates);
    });
  };

  private genId = () => idGenerator('sessionGroups');
}
