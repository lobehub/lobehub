import { ScmIdentityModel } from '@/database/models/scm';
import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import type { DeviceSystemInfoRead } from '@/server/services/deviceGateway';
import { githubNoreplyEmail } from '@/server/services/scm/github/userToken';

import type { RequesterCredentialDeviceRow } from './deviceScope';
import { isRequesterCredentialDevice } from './deviceScope';
import type { RunRequesterInput } from './resolveRunRequester';
import { resolveRunRequester } from './resolveRunRequester';

export const SCM_CREDENTIAL_DEVICE_TOOL = 'scm-credential';

export interface ScmCredentialIdentity {
  gitEmail?: string;
  gitName?: string;
}

export type DeviceRequesterCredential =
  | { kind: 'off' }
  | { jwt: string; kind: 'issue'; requesterLine: string; scmCredential: ScmCredentialIdentity }
  | {
      detail: string;
      kind: 'refuse';
      reason: 'cli_too_old' | 'device_unreachable' | 'no_requester';
    };

export const resolveDeviceRequesterCredential = async (params: {
  db: LobeChatDatabase;
  device: RequesterCredentialDeviceRow | undefined | null;
  deviceId: string;
  readSystemInfo: (clientKinds: ['cli']) => Promise<DeviceSystemInfoRead>;
  requesterInput: RunRequesterInput;
  resign: (extra: { deviceId: string; requesterUserId: string }) => Promise<string>;
}): Promise<DeviceRequesterCredential> => {
  const { db, device, deviceId } = params;
  if (!device?.workspaceId || !isRequesterCredentialDevice(device)) return { kind: 'off' };

  const enabled = await new WorkspaceModel(
    db,
    params.requesterInput.ownerUserId,
  ).getScmRequesterCredential(device.workspaceId);
  if (!enabled) return { kind: 'off' };

  const requesterUserId = await resolveRunRequester(db, params.requesterInput);
  if (!requesterUserId) {
    return {
      detail:
        'This workspace pushes to GitHub as the member who started a run, and this run has no member behind it. Start it from a chat, a task or a linked account.',
      kind: 'refuse',
      reason: 'no_requester',
    };
  }

  const info = await params.readSystemInfo(['cli']);
  if (!info.ok) {
    return {
      detail:
        "The shared device didn't answer, so LobeHub can't confirm it will push with the requester's GitHub account. Try again in a moment.",
      kind: 'refuse',
      reason: 'device_unreachable',
    };
  }
  if (!info.systemInfo.supportedTools?.includes(SCM_CREDENTIAL_DEVICE_TOOL)) {
    return {
      detail:
        "The lh CLI on this shared device is too old to push with the requester's GitHub account. Update lh on the device and reconnect it.",
      kind: 'refuse',
      reason: 'cli_too_old',
    };
  }

  const identity = await ScmIdentityModel.findByUser(db, 'github', requesterUserId);
  const scmCredential: ScmCredentialIdentity = identity
    ? {
        gitEmail: githubNoreplyEmail(identity),
        gitName: identity.metadata.name || identity.externalLogin,
      }
    : {};
  const requesterLine = identity
    ? `This run was requested by ${scmCredential.gitName} (@${identity.externalLogin}). Git commits and pushes on this device use their GitHub identity.`
    : 'Git commits and pushes on this device use the GitHub identity of the member who requested this run; they have not connected GitHub yet, so pushes will ask them to.';

  return {
    jwt: await params.resign({ deviceId, requesterUserId }),
    kind: 'issue',
    requesterLine,
    scmCredential,
  };
};
