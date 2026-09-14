import type { WorkspaceContext } from '@lobechat/context-engine';

import { WorkspaceModel } from '@/database/models/workspace';
import { appEnv } from '@/envs/app';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

import type { ServerContextFactInput } from './types';

const getAppUrl = (): string | undefined => {
  try {
    return appEnv.APP_URL;
  } catch {
    return process.env.APP_URL;
  }
};

/**
 * Where the run lives — app origin + workspace slug — so the model can write
 * in-app links that resolve to the right scope. Without this the model has no
 * idea it is inside a team workspace and composes personal-space (or
 * training-data) URLs. Best-effort: a failed lookup skips the block.
 */
export const resolveWorkspaceContextFacts = async ({
  ctx,
  workspaceId,
}: ServerContextFactInput): Promise<WorkspaceContext | undefined> => {
  // A share visitor converses under the CREATOR's identity: the creator's
  // routes (workspace or personal) are not the visitor's, so never describe
  // that scope to them — skip the block entirely, whatever the run's scope.
  if (ctx.agentShareVisitor) return undefined;

  const appUrl = getAppUrl();

  // Personal space: the origin alone is enough to anchor links.
  if (!workspaceId) return appUrl ? { appUrl } : undefined;

  // Workspace run whose slug cannot be resolved: injecting origin-only would
  // wrongly tell the model it is in the personal space, so inject nothing
  // (the pre-fix behaviour) rather than a false statement.
  if (!ctx.serverDB || !ctx.userId) return undefined;

  try {
    const workspace = await new WorkspaceModel(ctx.serverDB, ctx.userId).findById(workspaceId);
    if (!workspace?.slug) {
      log('Workspace %s has no slug; skipping workspace context', workspaceId);
      return undefined;
    }

    return { appUrl, workspace: { slug: workspace.slug } };
  } catch (error) {
    log('Failed to resolve workspace context for %s: %O', workspaceId, error);
    return undefined;
  }
};
