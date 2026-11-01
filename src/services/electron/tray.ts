import type { TrayNavigationSnapshot } from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class DesktopTrayService {
  updateNavigationSnapshot = async (snapshot: TrayNavigationSnapshot) => {
    return ensureElectronIpc().tray.updateNavigationSnapshot(snapshot);
  };
}

export const desktopTrayService = new DesktopTrayService();
