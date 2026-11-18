import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import type { LobeChatDatabase } from '@lobechat/database';
import { parseTfsRepository } from '@lobechat/utils/tfs';

import { DeviceModel } from '@/database/models/device';
import { executeAuthorizedDeviceToolCall } from '@/server/services/deviceGateway/authorizedToolCall';
import { resolveSandboxInitialization } from '@/server/services/sandbox/session';

import { buildTfsDeviceCheckout } from './deviceCheckoutCommand';

/** Personal bindings may initialize the caller's own machine, never another member's device. */
export const initializeTfsDeviceCheckout = async (params: {
  cwd?: string;
  db: LobeChatDatabase;
  deviceId: string;
  deviceWorkspaceId?: string;
  operationId?: string;
  topicId: string;
  userId: string;
  workspaceId?: string;
}): Promise<string | undefined> => {
  const init = await resolveSandboxInitialization({
    serverDB: params.db,
    topicId: params.topicId,
    userId: params.userId,
    workspaceId: params.workspaceId,
    sharedDrive: false,
    useProjectDefault: true,
  });
  if (!init?.sources.some((source) => parseTfsRepository(source.url))) return;
  if (!params.cwd) return 'TFS checkout: choose a working folder on the device first.';
  // A shared machine can inspect command environments; keep personal credentials off it.
  if (
    params.deviceWorkspaceId ||
    !(await new DeviceModel(params.db, params.userId).findPersonalByDeviceId(params.deviceId))
  )
    return 'TFS checkout: this is not your personal device. Use its own Git credential manager or choose your personal device.';
  if (init.authorizationError || !init.cloneCredential || !('tfs' in init.cloneCredential))
    return 'TFS checkout: reconnect your personal TFS account in Settings > Integrations.';
  const credential = init.cloneCredential;
  try {
    const checkout = buildTfsDeviceCheckout({ credential, sources: init.sources });
    const result = await executeAuthorizedDeviceToolCall(
      params.db,
      {
        deviceId: params.deviceId,
        operationId: params.operationId,
        userId: params.userId,
      },
      {
        identifier: LocalSystemIdentifier,
        apiName: LocalSystemApiName.runCommand,
        arguments: JSON.stringify({ ...checkout, cwd: params.cwd, timeout: 600_000 }),
      },
      610_000,
    );
    // Device result state can contain the request's environment; only return scrubbed text.
    const content = result.content.split(credential.tfs.secret).join('[redacted]');
    return `TFS checkout: ${content}`;
  } catch {
    return 'TFS checkout failed. Check device connectivity and your personal TFS permissions; existing files were preserved.';
  }
};
