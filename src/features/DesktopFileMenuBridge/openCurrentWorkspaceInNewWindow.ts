import { tabScopeHomeUrl } from '@/features/Electron/titlebar/TabBar/scope';
import { useElectronStore } from '@/store/electron';
import { ensureElectronIpc } from '@/utils/electron/ipc';

// Open the active tab's workspace (or personal home) in a new window, sized like this one.
// No uniqueId: every New Window opens a fresh window, like a browser.
export const openCurrentWorkspaceInNewWindow = async () => {
  try {
    const { activeTabScope } = useElectronStore.getState();
    const result = await ensureElectronIpc().windows.createMultiInstanceWindow({
      inheritCurrentWindowSize: true,
      path: tabScopeHomeUrl(activeTabScope),
      templateId: 'chatSingle',
    });

    if (!result.success) console.error('Failed to open new window:', result.error);
  } catch (error) {
    console.error('Error opening new window:', error);
  }
};
