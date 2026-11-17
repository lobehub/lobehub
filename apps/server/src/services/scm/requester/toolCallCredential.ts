import type { ChatTopicBotContext } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { DeviceModel } from '@/database/models/device';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { signHeteroOperationJWT } from '@/libs/trpc/utils/internalJwt';
import type { DeviceSystemInfoRead } from '@/server/services/deviceGateway';

import { resolveDeviceRequesterCredential } from './deviceCredential';

export const SCM_CREDENTIAL_TOOL_ARG = '__scmCredential';

const TOOL_CALL_TOKEN_LIFETIME = '5m';

export interface ToolCallScmCredentialArg {
  gitEmail?: string;
  gitName?: string;
  jwt: string;
}

export type ToolCallScmCredential =
  | { kind: 'off' }
  | { arg: ToolCallScmCredentialArg; kind: 'issue' }
  | { detail: string; kind: 'refuse' };

export const resolveToolCallScmCredential = async (params: {
  botContext?: Pick<ChatTopicBotContext, 'isOwner' | 'platform' | 'senderExternalUserId'>;
  db: LobeChatDatabase;
  deviceId: string;
  deviceWorkspaceId?: string;
  operationId?: string;
  ownerUserId: string;
  readSystemInfo: (clientKinds: ['cli']) => Promise<DeviceSystemInfoRead>;
  runWorkspaceId?: string;
  shareVisitorUserId?: string;
}): Promise<ToolCallScmCredential> => {
  const { db, deviceId, deviceWorkspaceId, operationId, ownerUserId } = params;
  if (!deviceWorkspaceId || !operationId) return { kind: 'off' };

  const [device, [operation]] = await Promise.all([
    new DeviceModel(db, ownerUserId, deviceWorkspaceId).findWorkspaceDeviceById(deviceId),
    db
      .select({ trigger: agentOperations.trigger })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId))
      .limit(1),
  ]);

  const { botContext } = params;
  const result = await resolveDeviceRequesterCredential({
    db,
    device,
    deviceId,
    readSystemInfo: params.readSystemInfo,
    requesterInput: {
      botIsOwner: botContext?.isOwner === true,
      botSender: botContext
        ? { id: botContext.senderExternalUserId, platform: botContext.platform }
        : undefined,
      ownerUserId,
      shareVisitorUserId: params.shareVisitorUserId,
      trigger: operation?.trigger ?? undefined,
    },
    resign: ({ requesterUserId }) =>
      signHeteroOperationJWT({
        capabilities: ['scm:github-credential'],
        deviceId,
        expiration: TOOL_CALL_TOKEN_LIFETIME,
        operationId,
        requesterUserId,
        userId: ownerUserId,
        workspaceId: params.runWorkspaceId,
      }),
  });

  switch (result.kind) {
    case 'issue': {
      return {
        arg: { ...result.scmCredential, jwt: result.jwt },
        kind: 'issue',
      };
    }
    case 'refuse': {
      return { detail: result.detail, kind: 'refuse' };
    }
    default: {
      return { kind: 'off' };
    }
  }
};
