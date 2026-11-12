import type { ConnectorVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import type { AgentModel } from '@/database/models/agent';
import type { ConnectorModel } from '@/database/models/connector';

import { canManageWorkspaceConnectors } from './connectorManagePolicy';

export interface ConnectorWriteCtx {
  agentModel: AgentModel;
  userId: string;
  workspaceId?: string | null;
}

/**
 * The visibility a base connector is written with: only a workspace row can be
 * private; personal rows are implicitly their owner's.
 */
export const resolveWriteVisibility = (
  ctx: Pick<ConnectorWriteCtx, 'workspaceId'>,
  requested: ConnectorVisibility | undefined,
): ConnectorVisibility => (ctx.workspaceId && requested === 'private' ? 'private' : 'public');

/**
 * A private connector serves only its creator's private agents. Binding,
 * copying or mounting it onto a workspace agent would hand the creator's
 * credentials to every member who runs that agent, so it is refused.
 */
export const assertPrivateConnectorTarget = async (
  ctx: ConnectorWriteCtx,
  connector: { userId: string; visibility: ConnectorVisibility },
  agentId: string,
): Promise<void> => {
  if (!ctx.workspaceId || connector.visibility !== 'private') return;
  if (
    connector.userId !== ctx.userId ||
    (await ctx.agentModel.getAgentVisibility(agentId)) !== 'private'
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'A private connector can only be used by your own private agents',
    });
  }
};

/**
 * Validate a visibility change on an existing workspace connector and return
 * the new value, or `undefined` when nothing changes.
 *
 * - Only the creator decides: making it private takes it away from every
 *   other member, making it shared hands the creator's credentials to them.
 * - Sharing it follows the member policy for shared connectors.
 * - Agent-scoped rows follow their agent and are not switched here.
 * - At most one shared row and one private row per member per identifier.
 */
export const resolveVisibilityChange = async (
  ctx: ConnectorWriteCtx &
    Parameters<typeof canManageWorkspaceConnectors>[0] & { connectorModel: ConnectorModel },
  target: {
    agentId: string | null;
    id: string;
    identifier: string;
    userId: string;
    visibility: ConnectorVisibility;
  },
  requested: ConnectorVisibility | undefined,
): Promise<ConnectorVisibility | undefined> => {
  if (!ctx.workspaceId || !requested || requested === target.visibility) return undefined;
  if (target.agentId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "An agent's connector follows its agent; change the agent instead",
    });
  }
  if (target.userId !== ctx.userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the member who added this connector can change who it is shared with',
    });
  }
  if (requested === 'public' && !(await canManageWorkspaceConnectors(ctx))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only workspace owners and admins can share connectors in this workspace',
    });
  }
  const clash = await ctx.connectorModel.findScopedByIdentifier(
    target.identifier,
    undefined,
    undefined,
    requested,
  );
  if (clash && clash.id !== target.id) {
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        requested === 'public'
          ? `The workspace already shares a "${target.identifier}" connector`
          : `You already have a private "${target.identifier}" connector`,
    });
  }
  return requested;
};
