import { deviceGateway, type DeviceSystemInfoRead } from '@/server/services/deviceGateway';
import {
  resolveToolCallScmCredential,
  type ToolCallScmCredential,
} from '@/server/services/scm/requester/toolCallCredential';

import { type ToolExecutionContext } from '../types';

const SYSTEM_INFO_TTL_MS = 5 * 60 * 1000;

// Every command on a shared device needs this answer, and it only changes when
// the device's CLI is upgraded; a failed read is never kept.
const systemInfoCache = new Map<string, { at: number; info: DeviceSystemInfoRead }>();

const readCliSystemInfo = async (userId: string, deviceId: string, workspaceId?: string) => {
  const key = `${workspaceId ?? ''}:${deviceId}`;
  const cached = systemInfoCache.get(key);
  if (cached && Date.now() - cached.at < SYSTEM_INFO_TTL_MS) return cached.info;

  const info = await deviceGateway.readDeviceSystemInfo(userId, deviceId, workspaceId, {
    clientKinds: ['cli'],
  });
  if (info.ok) systemInfoCache.set(key, { at: Date.now(), info });
  else systemInfoCache.delete(key);
  return info;
};

export const resolveContextScmCredential = async (
  context: ToolExecutionContext,
  scopes: {
    contentWorkspaceId: () => Promise<string | undefined>;
    deviceWorkspaceId: () => Promise<string | undefined>;
  },
): Promise<ToolCallScmCredential> => {
  const { activeDeviceId, serverDB, userId } = context;
  if (!serverDB || !activeDeviceId || !userId) return { kind: 'off' };

  const deviceWorkspaceId = await scopes.deviceWorkspaceId();
  return resolveToolCallScmCredential({
    botContext: context.botContext,
    db: serverDB,
    deviceId: activeDeviceId,
    deviceWorkspaceId,
    operationId: context.operationId,
    ownerUserId: userId,
    readSystemInfo: () => readCliSystemInfo(userId, activeDeviceId, deviceWorkspaceId),
    runWorkspaceId: await scopes.contentWorkspaceId(),
    shareVisitorUserId: context.agentShareVisitor?.visitorUserId,
  });
};
