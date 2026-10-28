// Fixture: the write reuses an id that a scoped, locked lookup in the same transaction
// just returned, and the method returns on a miss.
import { and, eq, isNull } from 'drizzle-orm';

import { buildWorkspaceWhere, type Database, documents } from './schema';

export class UserSkillModel {
  constructor(
    private db: Database,
    private userId: string,
    private workspaceId?: string,
  ) {}

  private scope = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents);

  private bundleWhere = () =>
    and(this.scope(), eq(documents.fileType, 'skills/bundle'), isNull(documents.parentId));

  /** Writes a new version. Returns undefined when the skill is not the caller's. */
  revise = async (id: string, content: string) =>
    this.db.transaction(async (tx) => {
      const [bundle] = await tx
        .select({ id: documents.id, metadata: documents.metadata })
        .from(documents)
        .where(and(this.bundleWhere(), eq(documents.id, id)))
        .for('update')
        .limit(1);
      if (!bundle) return undefined;
      const version = ((bundle.metadata?.version as number | undefined) ?? 1) + 1;

      await tx
        .update(documents)
        .set({ content, metadata: { ...bundle.metadata, version }, updatedAt: new Date() })
        .where(eq(documents.id, id));
      return version;
    });
}
