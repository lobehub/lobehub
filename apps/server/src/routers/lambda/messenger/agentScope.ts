import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { RbacModel } from '@/database/models/rbac';
import { WorkspaceModel } from '@/database/models/workspace';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

const WORKSPACE_FEATURE_DISABLED_MESSAGE = 'Workspace feature is not enabled for this user';

export const isWorkspaceFeatureEnabledForUser = async (userId: string): Promise<boolean> => {
  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  return featureFlags.enableWorkspace === true;
};

export const assertWorkspaceFeatureEnabledForUser = async (userId: string): Promise<void> => {
  if (await isWorkspaceFeatureEnabledForUser(userId)) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: WORKSPACE_FEATURE_DISABLED_MESSAGE,
  });
};

/**
 * Resolve the workspace scope of an agent the user wants to route the System
 * Bot to, authorizing access along the way. Because the bot is shared and
 * which LobeHub context a conversation runs in is derived from the *active
 * agent*, every place that sets the active agent must re-authorize against
 * that agent's own workspace:
 *
 * - personal agent (`workspace_id IS NULL`): must be owned by the caller.
 * - workspace agent: caller must be a member AND hold `agent:update` in that
 *   workspace (mirrors `withScopedPermission('agent:update')`).
 *
 * Returns the derived `workspaceId` (null for personal) + the agent title.
 * Throws `NOT_FOUND` / `FORBIDDEN`.
 */
export const resolveAuthorizedAgentScope = async (
  serverDB: LobeChatDatabase,
  userId: string,
  agentId: string,
): Promise<{ title: string | null; workspaceId: string | null }> => {
  const [agentRow] = await serverDB
    .select({ title: agents.title, userId: agents.userId, workspaceId: agents.workspaceId })
    .from(agents)
    .where(and(eq(agents.id, agentId), notTrashed(agents.isDeleted)))
    .limit(1);
  if (!agentRow) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'messenger.error.agentNotFound' });
  }

  // Personal agent — only the owner may route the bot to it.
  if (!agentRow.workspaceId) {
    if (agentRow.userId !== userId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'messenger.error.agentNotFound' });
    }
    return { title: agentRow.title, workspaceId: null };
  }

  // Workspace agent — caller must be a member with `agent:update`.
  await assertWorkspaceFeatureEnabledForUser(userId);

  const userWorkspaces = await new WorkspaceModel(serverDB, userId).listUserWorkspaces();
  const isMember = userWorkspaces.some((w) => w.id === agentRow.workspaceId);
  if (!isMember) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'messenger.error.agentNotFound' });
  }
  const allowed = await new RbacModel(serverDB, userId).hasAnyPermission(
    ['agent:update:all', 'agent:update:owner'],
    { workspaceId: agentRow.workspaceId },
  );
  if (!allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'messenger.error.agentNotFound' });
  }
  return { title: agentRow.title, workspaceId: agentRow.workspaceId };
};
