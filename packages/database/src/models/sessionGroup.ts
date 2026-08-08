import { and, asc, count, desc, eq } from 'drizzle-orm';

import type { SessionGroupItem } from '../schemas';
import { agents, chatGroups, sessionGroups } from '../schemas';
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

  // Sidebar folders are the SHARED skeleton of a workspace sidebar: every
  // member sees and manages the same public folders (creating, renaming,
  // reordering and deleting them), exactly like any other workspace-public
  // resource. Private folders stay constrained to their creator by the
  // standard visibility predicate. Members who don't want a folder in their
  // own sidebar hide it through `sidebarHiddenGroupIds` — a personal
  // preference that never touches these rows.
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

  /**
   * Rename / reorder only. The scope columns (`userId`, `workspaceId`,
   * `visibility`) are deliberately not accepted: the ownership predicate now
   * matches every public folder in the workspace, so allowing them here would
   * let any member re-scope another member's Category. Publishing has its own
   * one-way path.
   */
  update = async (id: string, value: Partial<Pick<SessionGroupItem, 'name' | 'sort'>>) => {
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
    // A folder cannot mix visibilities: the sidebar resolves a public item's
    // folder only against public folders and a private item's only against
    // private ones. Publishing a folder that still holds private items would
    // therefore silently evict the owner's own contents to Private → Ungrouped
    // while every other member received an empty shared folder. Promoting the
    // children instead would publish private work nobody asked to share, so
    // this refuses and leaves the choice with the user.
    const [{ privateChildren }] = await this.db
      .select({ privateChildren: count() })
      .from(agents)
      .where(and(eq(agents.sessionGroupId, id), eq(agents.visibility, 'private')));

    const [{ privateGroups }] = await this.db
      .select({ privateGroups: count() })
      .from(chatGroups)
      .where(and(eq(chatGroups.groupId, id), eq(chatGroups.visibility, 'private')));

    if (privateChildren > 0 || privateGroups > 0)
      throw new Error(
        'Move or publish the private items inside this folder before sharing it with the workspace',
      );

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
