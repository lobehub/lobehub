import { HotkeyEnum, HotkeyScopeEnum } from '@lobechat/types';
import { useEffect } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { useHotkeyById } from './useHotkeyById';

/**
 * Save document hotkey (Cmd+S / Ctrl+S)
 * @param flushSave - Function to flush pending saves
 */
export const useSaveDocumentHotkey = (flushSave: () => void) => {
  return useHotkeyById(
    HotkeyEnum.SaveDocument,
    () => {
      flushSave();
    },
    {
      enableOnContentEditable: true,
    },
  );
};

/**
 * Register Files scope and enable it
 * Use this in components that need Files scope hotkeys
 */
export const useRegisterFilesHotkeys = () => {
  const { enableScope, disableScope } = useHotkeysContext();

  useEffect(() => {
    enableScope(HotkeyScopeEnum.Files);
    return () => disableScope(HotkeyScopeEnum.Files);
  }, [enableScope, disableScope]);

  return null;
};
