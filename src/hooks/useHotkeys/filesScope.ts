import { HotkeyEnum, HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { useEffect } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { useHotkeyById } from './useHotkeyById';

/**
 * Save document hotkey (Cmd+S / Ctrl+S)
 * @param onSave - Callback invoked when the save hotkey is triggered
 */
export const useSaveDocumentHotkey = (onSave: () => void | Promise<void>) => {
  return useHotkeyById(
    HotkeyEnum.SaveDocument,
    () => {
      void onSave();
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
