import { ensureElectronIpc } from '@/utils/electron/ipc';

class AutoUpdateService {
  checkUpdate = async () => {
    return ensureElectronIpc().autoUpdate.checkForUpdates();
  };

  installNow = async () => {
    return ensureElectronIpc().autoUpdate.quitAndInstallUpdate();
  };

  installLater = async () => {
    return ensureElectronIpc().autoUpdate.installLater();
  };

  downloadUpdate() {
    return ensureElectronIpc().autoUpdate.downloadUpdate();
  }
}

export const autoUpdateService = new AutoUpdateService();
