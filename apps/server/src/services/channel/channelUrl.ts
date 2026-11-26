import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';

/**
 * The app link to a Channel, as a tool result hands it to the person: under the workspace's slug
 * when the caller is in one, and under its project when the Channel belongs to one. A workspace
 * that cannot be read links without its slug rather than failing the post.
 */
export const channelUrl = async (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  channelId: string,
  projectId: string | null,
): Promise<string> => {
  const origin = appEnv.APP_URL.replace(/\/$/, '');
  const slug = scope.workspaceId
    ? await new WorkspaceModel(db, scope.userId)
        .findById(scope.workspaceId)
        .then((workspace) => workspace?.slug ?? undefined)
        .catch(() => undefined)
    : undefined;
  const base = slug ? `${origin}/${slug}` : origin;
  return projectId
    ? `${base}/project/${projectId}/channels/${channelId}`
    : `${base}/channels/${channelId}`;
};
