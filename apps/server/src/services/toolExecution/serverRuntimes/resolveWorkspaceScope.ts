import debug from 'debug';
import { and, eq } from 'drizzle-orm';

import { agents, tasks } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';

import { type ToolExecutionContext } from '../types';

const log = debug('lobe-server:device-scope');

type DeviceScopeContext = Pick<
  ToolExecutionContext,
  'activeDeviceScope' | 'agentId' | 'serverDB' | 'workspaceId'
>;

/**
 * Recover a task's content scope for runtimes whose older execution context
 * did not preserve workspaceId. A present task anchor must fail closed when
 * its live row has disappeared; only a live personal task resolves to
 * `undefined` legitimately.
 */
export const resolveTaskWorkspaceId = async (
  db: LobeChatDatabase,
  taskId: string | undefined,
  expectedWorkspaceId?: string,
): Promise<string | undefined> => {
  if (!taskId) return expectedWorkspaceId;

  const [row] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), notTrashed(tasks.isDeleted)))
    .limit(1);

  if (!row)
    throw new Error(`Cannot recover workspace scope from missing or trashed task ${taskId}`);

  const taskWorkspaceId = row.workspaceId ?? undefined;
  if (expectedWorkspaceId !== undefined && taskWorkspaceId !== expectedWorkspaceId) {
    throw new Error(
      `Task ${taskId} belongs to workspace ${taskWorkspaceId ?? 'personal'}, not ${expectedWorkspaceId}`,
    );
  }

  return taskWorkspaceId;
};

/**
 * The workspace whose CONTENT this run reads and writes: the run-scoped
 * `context.workspaceId`, or — when that was lost on the way to this tool call
 * (some dispatch / resume paths do not thread it through to
 * `ToolExecutionContext`) — the running agent's durable `workspace_id`.
 *
 * Unscoped lookup by id on purpose: the run already authorized this agent, we
 * only read which workspace it belongs to.
 *
 * Deliberately free of the personal-device exception in `resolveRunWorkspaceId`
 * below — that exception is about which gateway pool to ADDRESS, which is a
 * different question from which workspace's data a call operates on. A
 * workspace agent routed to the caller's own machine still edits workspace
 * content, so `lh` running there must carry `LOBEHUB_WORKSPACE_ID` or the CLI
 * silently resolves to personal scope and the agent cannot even find itself.
 */
export const resolveContentWorkspaceId = async (
  context: Pick<DeviceScopeContext, 'agentId' | 'serverDB' | 'workspaceId'>,
): Promise<string | undefined> => {
  if (context.workspaceId) return context.workspaceId;

  const { agentId, serverDB } = context;
  if (!agentId || !serverDB) return undefined;

  try {
    const [row] = await serverDB
      .select({ workspaceId: agents.workspaceId })
      .from(agents)
      .where(and(eq(agents.id, agentId), notTrashed(agents.isDeleted)))
      .limit(1);
    if (!row)
      throw new Error(`Cannot recover workspace scope from missing or trashed agent ${agentId}`);
    return row.workspaceId ?? undefined;
  } catch (error) {
    log('failed to recover workspaceId from agent %s: %O', agentId, error);
    throw error;
  }
};

/**
 * The workspace principal a device tool call should be ADDRESSED under.
 *
 * Both device runtimes resolve scope through this single path so a run stays
 * consistent: `remote-device` lists/activates the workspace device, and the
 * `local-system` filesystem/shell calls that follow route to the same
 * `workspace:<id>` gateway pool instead of silently falling back to the personal
 * pool.
 *
 * EXCEPTION: a run whose active device is PERSONAL-scope (a workspace agent
 * routed to the caller's own machine via the per-user `local` override,
 *) must be addressed through the personal `(userId, deviceId)`
 * pool — that device has no connection under the `workspace:<id>` principal,
 * so a workspace-addressed call would simply miss it.
 */
export const resolveRunWorkspaceId = async (
  context: DeviceScopeContext,
): Promise<string | undefined> => {
  if (context.activeDeviceScope === 'personal') return undefined;

  return resolveContentWorkspaceId(context);
};
