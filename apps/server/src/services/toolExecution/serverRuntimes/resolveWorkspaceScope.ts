import debug from 'debug';
import { eq } from 'drizzle-orm';

import { agents } from '@/database/schemas';

import { type ToolExecutionContext } from '../types';

const log = debug('lobe-server:device-scope');

type DeviceScopeContext = Pick<
  ToolExecutionContext,
  'activeDeviceScope' | 'agentId' | 'serverDB' | 'workspaceId'
>;

/**
 * The workspace scope a device tool call should run under: the run-scoped
 * `context.workspaceId`, or — when that was lost on the way to this tool call
 * (some dispatch / resume paths do not thread it through to
 * `ToolExecutionContext`) — the running agent's durable `workspace_id`.
 *
 * Both device runtimes resolve scope through this single path so a run stays
 * consistent: `remote-device` lists/activates the workspace device, and the
 * `local-system` filesystem/shell calls that follow route to the same
 * `workspace:<id>` gateway pool instead of silently falling back to the personal
 * pool. Unscoped lookup by id on purpose: the run already authorized this agent,
 * we only read which workspace it belongs to.
 *
 * EXCEPTION: a run whose active device is PERSONAL-scope (a workspace agent
 * routed to the caller's own machine via the per-user `local` override,
 * LOBE-11689) must be addressed through the personal `(userId, deviceId)`
 * pool — that device has no connection under the `workspace:<id>` principal,
 * so a workspace-addressed call would simply miss it.
 */
export const resolveRunWorkspaceId = async (
  context: DeviceScopeContext,
): Promise<string | undefined> => {
  if (context.activeDeviceScope === 'personal') return undefined;
  if (context.workspaceId) return context.workspaceId;

  const { agentId, serverDB } = context;
  if (!agentId || !serverDB) return undefined;

  try {
    const [row] = await serverDB
      .select({ workspaceId: agents.workspaceId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return row?.workspaceId ?? undefined;
  } catch (error) {
    log('failed to recover workspaceId from agent %s: %O', agentId, error);
    return undefined;
  }
};
