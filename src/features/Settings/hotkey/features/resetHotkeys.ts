import { DESKTOP_HOTKEYS_REGISTRATION } from '@lobechat/const/desktopGlobalShortcuts';
import type { ShortcutUpdateResult } from '@lobechat/electron-client-ipc';

type UpdateDesktopHotkey = (id: string, accelerator: string) => Promise<ShortcutUpdateResult>;

export const resetDesktopHotkeys = async (
  updateDesktopHotkey: UpdateDesktopHotkey,
): Promise<ShortcutUpdateResult> => {
  // Clear first so swapped custom bindings cannot conflict with the defaults being restored.
  for (const item of DESKTOP_HOTKEYS_REGISTRATION) {
    const result = await updateDesktopHotkey(item.id, '');
    if (!result.success) return result;
  }

  for (const item of DESKTOP_HOTKEYS_REGISTRATION) {
    if (!item.keys) continue;

    const result = await updateDesktopHotkey(item.id, item.keys);
    if (!result.success) return result;
  }

  return { success: true };
};
