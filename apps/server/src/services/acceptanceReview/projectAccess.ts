import type { ProjectMemberRole } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { ProjectMemberModel } from '@/database/models/projectReview';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { projects } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

export type ProjectReviewScope = Pick<
  typeof projects.$inferSelect,
  'id' | 'name' | 'userId' | 'workspaceId'
>;

export type ProjectReviewRole = ProjectMemberRole;

export async function findProjectReviewScope(
  db: LobeChatDatabase,
  projectId: string,
): Promise<ProjectReviewScope | null> {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      userId: projects.userId,
      workspaceId: projects.workspaceId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project ?? null;
}

export async function resolveProjectReviewRole(
  db: LobeChatDatabase,
  userId: string | null | undefined,
  project: ProjectReviewScope,
): Promise<ProjectReviewRole | null> {
  if (!userId) return null;
  if (!project.workspaceId) return project.userId === userId ? 'admin' : null;
  const teammate = await new WorkspaceMemberModel(db, userId).getMember(
    project.workspaceId,
    userId,
  );
  if (!teammate) return null;
  const override = await new ProjectMemberModel(db).findActive(project.id, userId);
  const role = override?.role ?? teammate.role;
  if (role === 'owner' || role === 'admin') return 'admin';
  return role === 'member' || role === 'viewer' ? role : null;
}
