import type { DeviceOperationRecord } from '@/business/server/deviceOperationAudit';

/**
 * Operations a person runs on a device outside an agent run that can read,
 * change or expose what is on it. Each successful call is reported to
 * `recordDeviceOperation` so a deployment can keep an audit trail. Terminal
 * output polling (`readTerminal`) is not: it only returns what the input
 * already caused.
 */
export const AUDITED_DEVICE_OPERATIONS: ReadonlySet<string> = new Set([
  'browseDirectory',
  'closeTerminal',
  'copyAssetForPublish',
  'copyProjectFiles',
  'createDirectory',
  'createProjectDirectory',
  'createProjectFile',
  'createTerminalSession',
  'createTunnel',
  'getLocalFilePreview',
  'listProjectDirectory',
  'moveProjectFiles',
  'openTunnel',
  'readExternalAssetForPublish',
  'renameProjectFile',
  'revertGitFile',
  'statPath',
  'trashProjectFiles',
  'writeProjectFile',
  'writeTerminal',
]);

/** Whether a tRPC path such as `device.writeTerminal` is audited. */
export const isAuditedDeviceOperation = (path: string) =>
  AUDITED_DEVICE_OPERATIONS.has(path.slice(path.lastIndexOf('.') + 1));

/** The audit record of a call, or `undefined` when its input names no device. */
export const deviceOperationRecordOf = ({
  input,
  operation,
  userId,
  workspaceId,
}: {
  input: unknown;
  operation: string;
  userId: string;
  workspaceId?: string;
}): DeviceOperationRecord | undefined => {
  if (!input || typeof input !== 'object') return;
  const fields = input as Record<string, unknown>;
  if (typeof fields.deviceId !== 'string') return;
  return {
    deviceId: fields.deviceId,
    input: fields,
    operation,
    userId,
    ...(workspaceId ? { workspaceId } : {}),
  };
};
