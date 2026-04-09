import type { ToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import { useMemo } from 'react';

import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/slices/builtinTool/selectors';
import { useElectronStore } from '@/store/electron';
import { desktopStateSelectors } from '@/store/electron/selectors';

/**
 * Provides platform-aware capabilities for tool render components.
 * In Electron: provides file operations, loading state, relative paths.
 * In browser: provides only loading state (no file operations).
 */
export const useToolRenderCaps = (): ToolRenderCapabilities => {
  const isElectron = typeof window !== 'undefined' && !!(window as any).__ELECTRON__;

  return useMemo<ToolRenderCapabilities>(() => {
    const caps: ToolRenderCapabilities = {
      isLoading: (messageId: string) => {
        return chatToolSelectors.isSearchingLocalFiles(messageId)(useChatStore.getState());
      },
    };

    if (isElectron) {
      caps.openFile = (path: string) => {
        localFileService.openLocalFile({ path });
      };
      caps.openFolder = (path: string) => {
        localFileService.openLocalFolder({ isDirectory: false, path });
      };
      caps.displayRelativePath = (path: string) => {
        return desktopStateSelectors.displayRelativePath(path)(useElectronStore.getState());
      };
    }

    return caps;
  }, [isElectron]);
};
