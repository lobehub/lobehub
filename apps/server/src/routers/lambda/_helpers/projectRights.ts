import type { WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';
import type { ProjectModelOptions } from '@/database/models/project';

/**
 * The caller's project rights from their workspace role. Reads `workspaceRole` as an optional
 * context field: the cloud workspace-auth override injects it, while the OSS stub leaves it absent.
 * Workspace owners and admins manage every readable project's members; viewers hold no
 * `agent:update` grant, so they only read.
 */
export const projectModelOptions = (ctx: {
  workspaceId?: string | null;
  workspaceRole?: WorkspaceRole;
}): ProjectModelOptions => ({
  canManageAllMembers: ctx.workspaceRole === 'owner' || ctx.workspaceRole === 'admin',
  readOnly: !!ctx.workspaceId && ctx.workspaceRole === 'viewer',
});
