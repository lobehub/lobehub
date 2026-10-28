import { DeviceModel } from '@/database/models/device';
import { hasActiveWorkspaceMembership } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { validateMcpDeviceGrant } from '@/libs/trpc/utils/internalJwt';

import type { McpCallIdentity } from './McpElicitationService';

/** The login authenticates the device owner; the ticket authorizes only this initiator's invocation. */
export async function resolveMcpProducerUser(
  ctx: { serverDB: LobeChatDatabase; userId: string; workspaceId?: string | null },
  identity: McpCallIdentity,
  delegation?: string,
  deadline?: number,
) {
  if (!delegation) return ctx.userId;
  const grant = await validateMcpDeviceGrant(delegation);
  if (
    !grant ||
    !ctx.workspaceId ||
    grant.workspaceId !== ctx.workspaceId ||
    (deadline !== undefined && deadline > grant.deadline) ||
    !(
      [
        'operationId',
        'assistantMessageId',
        'toolCallId',
        'toolMessageId',
        'identifier',
        'apiName',
      ] as const
    ).every((key) => grant[key] === identity[key])
  )
    throw new Error('Invalid MCP device callback authorization');
  for (const userId of new Set([ctx.userId, grant.userId]))
    if (
      !(await hasActiveWorkspaceMembership(ctx.serverDB, { userId, workspaceId: ctx.workspaceId }))
    )
      throw new Error('MCP device callback workspace membership ended');
  const device = await new DeviceModel(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId,
  ).findWorkspaceDeviceById(grant.deviceId);
  // Recheck registry ownership and visibility, including unshare since dispatch.
  if (
    !device ||
    device.userId !== ctx.userId ||
    (grant.userId !== ctx.userId && device.visibility !== 'public')
  )
    throw new Error('MCP callback device is no longer authorized');
  return grant.userId;
}
