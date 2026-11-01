import { ipcRenderer } from 'electron';

import { fromIpcErrorEnvelope, isIpcErrorEnvelope } from '~common/ipcError';

type IpcInvoke = <T = unknown>(event: string, ...data: unknown[]) => Promise<T>;

/**
 * Client-side method to invoke electron main process.
 *
 * The main-process handler returns an error envelope instead of throwing (see
 * `~common/ipcError`), so structured failure detail — notably `cause` — isn't
 * flattened away by Electron's thrown-error serialization. Rebuild the real
 * Error here and re-throw it, preserving the "promise rejects on failure"
 * contract every caller already relies on.
 */
export const invoke: IpcInvoke = async (event, ...data) => {
  const result = await ipcRenderer.invoke(event, ...data);

  if (isIpcErrorEnvelope(result)) {
    throw fromIpcErrorEnvelope(result);
  }

  return result as never;
};
