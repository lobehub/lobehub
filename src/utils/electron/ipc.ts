import { getElectronIpc } from '@lobechat/electron-client-ipc';
import { type DesktopIpcServices } from '@lobehub/desktop-ipc-typings';

export const ensureElectronIpc = (): DesktopIpcServices => {
  const ipc = getElectronIpc();
  if (!ipc) {
    throw new Error(
      'electronAPI.invoke not found. Ensure the preload exposes invoke via window.electronAPI.invoke',
    );
  }
  return ipc;
};
