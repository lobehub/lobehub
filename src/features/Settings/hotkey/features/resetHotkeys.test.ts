import type { ShortcutUpdateResult } from '@lobechat/electron-client-ipc';
import { describe, expect, it, vi } from 'vitest';

import { resetDesktopHotkeys } from './resetHotkeys';

describe('resetDesktopHotkeys', () => {
  it('restores defaults even when custom bindings are swapped', async () => {
    const bindings: Record<string, string> = {
      openSettings: 'ctrl+comma',
      quickChat: 'alt+shift+space',
      quickComposer: 'alt+x',
      showApp: 'ctrl+y',
    };
    const updateDesktopHotkey = vi.fn(
      async (id: string, accelerator: string): Promise<ShortcutUpdateResult> => {
        const hasConflict = Object.entries(bindings).some(
          ([otherId, value]) => otherId !== id && accelerator && value === accelerator,
        );
        if (hasConflict) return { errorType: 'CONFLICT', success: false };

        bindings[id] = accelerator;
        return { success: true };
      },
    );

    const result = await resetDesktopHotkeys(updateDesktopHotkey);

    expect(result).toEqual({ success: true });
    expect(bindings).toEqual({
      openSettings: 'mod+comma',
      quickChat: '',
      quickComposer: 'alt+shift+space',
      showApp: '',
    });
  });

  it('returns the first desktop update failure', async () => {
    const updateDesktopHotkey = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ errorType: 'SYSTEM_OCCUPIED', success: false });

    const result = await resetDesktopHotkeys(updateDesktopHotkey);

    expect(result).toEqual({ errorType: 'SYSTEM_OCCUPIED', success: false });
    expect(updateDesktopHotkey).toHaveBeenCalledTimes(2);
  });
});
