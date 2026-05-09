import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCommandPressed, isMediaKey, isValidHotkeyKey, isValidHotkeyString } from './keyboard';
import * as platform from './platform';

describe('keyboard', () => {
  describe('isCommandPressed', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true when metaKey is pressed on macOS', () => {
      vi.spyOn(platform, 'isMacOS').mockReturnValue(true);

      const event = {
        metaKey: true,
        ctrlKey: false,
      } as KeyboardEvent;

      expect(isCommandPressed(event)).toBe(true);
    });

    it('should return false when metaKey is not pressed on macOS', () => {
      vi.spyOn(platform, 'isMacOS').mockReturnValue(true);

      const event = {
        metaKey: false,
        ctrlKey: false,
      } as KeyboardEvent;

      expect(isCommandPressed(event)).toBe(false);
    });

    it('should return true when ctrlKey is pressed on Windows/Linux', () => {
      vi.spyOn(platform, 'isMacOS').mockReturnValue(false);

      const event = {
        metaKey: false,
        ctrlKey: true,
      } as KeyboardEvent;

      expect(isCommandPressed(event)).toBe(true);
    });

    it('should return false when ctrlKey is not pressed on Windows/Linux', () => {
      vi.spyOn(platform, 'isMacOS').mockReturnValue(false);

      const event = {
        metaKey: false,
        ctrlKey: false,
      } as KeyboardEvent;

      expect(isCommandPressed(event)).toBe(false);
    });

    it('should ignore ctrlKey on macOS and only check metaKey', () => {
      vi.spyOn(platform, 'isMacOS').mockReturnValue(true);

      const event = {
        metaKey: false,
        ctrlKey: true, // ctrlKey should be ignored on macOS
      } as KeyboardEvent;

      expect(isCommandPressed(event)).toBe(false);
    });

    it('should ignore metaKey on Windows/Linux and only check ctrlKey', () => {
      vi.spyOn(platform, 'isMacOS').mockReturnValue(false);

      const event = {
        metaKey: true, // metaKey should be ignored on Windows/Linux
        ctrlKey: false,
      } as KeyboardEvent;

      expect(isCommandPressed(event)).toBe(false);
    });

    it('should handle both keys pressed on macOS correctly', () => {
      vi.spyOn(platform, 'isMacOS').mockReturnValue(true);

      const event = {
        metaKey: true,
        ctrlKey: true, // both pressed, but only metaKey matters on macOS
      } as KeyboardEvent;

      expect(isCommandPressed(event)).toBe(true);
    });

    it('should handle both keys pressed on Windows/Linux correctly', () => {
      vi.spyOn(platform, 'isMacOS').mockReturnValue(false);

      const event = {
        metaKey: true, // both pressed, but only ctrlKey matters on Windows/Linux
        ctrlKey: true,
      } as KeyboardEvent;

      expect(isCommandPressed(event)).toBe(true);
    });
  });

  describe('isMediaKey', () => {
    const makeEvent = (code: string) => ({ code }) as KeyboardEvent;

    it('should return true for VolumeMute', () => {
      expect(isMediaKey(makeEvent('VolumeMute'))).toBe(true);
    });

    it('should return true for VolumeUp', () => {
      expect(isMediaKey(makeEvent('VolumeUp'))).toBe(true);
    });

    it('should return true for VolumeDown', () => {
      expect(isMediaKey(makeEvent('VolumeDown'))).toBe(true);
    });

    it('should return true for AudioVolumeMute', () => {
      expect(isMediaKey(makeEvent('AudioVolumeMute'))).toBe(true);
    });

    it('should return true for MediaPlayPause', () => {
      expect(isMediaKey(makeEvent('MediaPlayPause'))).toBe(true);
    });

    it('should return true for MediaStop', () => {
      expect(isMediaKey(makeEvent('MediaStop'))).toBe(true);
    });

    it('should return true for MediaTrackNext', () => {
      expect(isMediaKey(makeEvent('MediaTrackNext'))).toBe(true);
    });

    it('should return true for MediaTrackPrevious', () => {
      expect(isMediaKey(makeEvent('MediaTrackPrevious'))).toBe(true);
    });

    it('should return true for BrowserHome', () => {
      expect(isMediaKey(makeEvent('BrowserHome'))).toBe(true);
    });

    it('should return true for BrowserSearch', () => {
      expect(isMediaKey(makeEvent('BrowserSearch'))).toBe(true);
    });

    it('should return true for LaunchMail', () => {
      expect(isMediaKey(makeEvent('LaunchMail'))).toBe(true);
    });

    it('should return true for LaunchApp1', () => {
      expect(isMediaKey(makeEvent('LaunchApp1'))).toBe(true);
    });

    it('should return false for KeyA', () => {
      expect(isMediaKey(makeEvent('KeyA'))).toBe(false);
    });

    it('should return false for Digit1', () => {
      expect(isMediaKey(makeEvent('Digit1'))).toBe(false);
    });

    it('should return false for Comma', () => {
      expect(isMediaKey(makeEvent('Comma'))).toBe(false);
    });

    it('should return false for Space', () => {
      expect(isMediaKey(makeEvent('Space'))).toBe(false);
    });

    it('should return false for F1', () => {
      expect(isMediaKey(makeEvent('F1'))).toBe(false);
    });

    it('should return false for ArrowUp', () => {
      expect(isMediaKey(makeEvent('ArrowUp'))).toBe(false);
    });

    it('should return false for AltLeft', () => {
      expect(isMediaKey(makeEvent('AltLeft'))).toBe(false);
    });

    it('should return false for ControlLeft', () => {
      expect(isMediaKey(makeEvent('ControlLeft'))).toBe(false);
    });

    it('should return false for ShiftLeft', () => {
      expect(isMediaKey(makeEvent('ShiftLeft'))).toBe(false);
    });

    it('should return false for MetaLeft', () => {
      expect(isMediaKey(makeEvent('MetaLeft'))).toBe(false);
    });

    it('should return false for empty code', () => {
      expect(isMediaKey(makeEvent(''))).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isMediaKey(makeEvent('VOLUMEMUTE'))).toBe(true);
      expect(isMediaKey(makeEvent('volumemute'))).toBe(true);
      expect(isMediaKey(makeEvent('VolumeMute'))).toBe(true);
    });
  });

  describe('isValidHotkeyKey', () => {
    const makeEvent = (code: string) => ({ code }) as KeyboardEvent;

    it('should return true for KeyA', () => {
      expect(isValidHotkeyKey(makeEvent('KeyA'))).toBe(true);
    });

    it('should return true for Digit0', () => {
      expect(isValidHotkeyKey(makeEvent('Digit0'))).toBe(true);
    });

    it('should return true for NumpadEnter', () => {
      expect(isValidHotkeyKey(makeEvent('NumpadEnter'))).toBe(true);
    });

    it('should return true for F12', () => {
      expect(isValidHotkeyKey(makeEvent('F12'))).toBe(true);
    });

    it('should return true for ArrowDown', () => {
      expect(isValidHotkeyKey(makeEvent('ArrowDown'))).toBe(true);
    });

    it('should return true for Comma', () => {
      expect(isValidHotkeyKey(makeEvent('Comma'))).toBe(true);
    });

    it('should return true for Space', () => {
      expect(isValidHotkeyKey(makeEvent('Space'))).toBe(true);
    });

    it('should return true for Backspace', () => {
      expect(isValidHotkeyKey(makeEvent('Backspace'))).toBe(true);
    });

    it('should return true for AltLeft', () => {
      expect(isValidHotkeyKey(makeEvent('AltLeft'))).toBe(true);
    });

    it('should return true for ControlLeft', () => {
      expect(isValidHotkeyKey(makeEvent('ControlLeft'))).toBe(true);
    });

    it('should return true for MetaLeft', () => {
      expect(isValidHotkeyKey(makeEvent('MetaLeft'))).toBe(true);
    });

    it('should return true for ShiftLeft', () => {
      expect(isValidHotkeyKey(makeEvent('ShiftLeft'))).toBe(true);
    });

    it('should return true for Escape', () => {
      expect(isValidHotkeyKey(makeEvent('Escape'))).toBe(true);
    });

    it('should return true for Enter', () => {
      expect(isValidHotkeyKey(makeEvent('Enter'))).toBe(true);
    });

    it('should return true for Tab', () => {
      expect(isValidHotkeyKey(makeEvent('Tab'))).toBe(true);
    });

    it('should return false for VolumeMute', () => {
      expect(isValidHotkeyKey(makeEvent('VolumeMute'))).toBe(false);
    });

    it('should return false for MediaPlayPause', () => {
      expect(isValidHotkeyKey(makeEvent('MediaPlayPause'))).toBe(false);
    });

    it('should return false for AudioVolumeUp', () => {
      expect(isValidHotkeyKey(makeEvent('AudioVolumeUp'))).toBe(false);
    });

    it('should return false for BrowserHome', () => {
      expect(isValidHotkeyKey(makeEvent('BrowserHome'))).toBe(false);
    });

    it('should return false for LaunchMail', () => {
      expect(isValidHotkeyKey(makeEvent('LaunchMail'))).toBe(false);
    });

    it('should return false for empty code', () => {
      expect(isValidHotkeyKey(makeEvent(''))).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isValidHotkeyKey(makeEvent('KEYA'))).toBe(true);
      expect(isValidHotkeyKey(makeEvent('keya'))).toBe(true);
      expect(isValidHotkeyKey(makeEvent('MEDIAPLAYPAUSE'))).toBe(false);
    });
  });

  describe('isValidHotkeyString', () => {
    it('should return true for mod+k', () => {
      expect(isValidHotkeyString('mod+k')).toBe(true);
    });

    it('should return true for alt+comma', () => {
      expect(isValidHotkeyString('alt+comma')).toBe(true);
    });

    it('should return true for ctrl+shift+slash', () => {
      expect(isValidHotkeyString('ctrl+shift+slash')).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(isValidHotkeyString('')).toBe(false);
    });

    it('should return false for whitespace only', () => {
      expect(isValidHotkeyString('   ')).toBe(false);
    });

    it('should return false for modifier-only (alt)', () => {
      expect(isValidHotkeyString('alt')).toBe(false);
    });

    it('should return false for modifier-only (ctrl+shift)', () => {
      expect(isValidHotkeyString('ctrl+shift')).toBe(false);
    });

    it('should return false for hotkey containing VolumeMute', () => {
      expect(isValidHotkeyString('mod+volumemute')).toBe(false);
    });

    it('should return false for hotkey containing MediaPlayPause', () => {
      expect(isValidHotkeyString('mediaplaypause')).toBe(false);
    });

    it('should return false for hotkey containing AudioVolumeUp', () => {
      expect(isValidHotkeyString('audiovolumeup')).toBe(false);
    });

    it('should return false for hotkey containing BrowserHome', () => {
      expect(isValidHotkeyString('browserhome')).toBe(false);
    });

    it('should return false for hotkey containing LaunchMail', () => {
      expect(isValidHotkeyString('ctrl+launchmail')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isValidHotkeyString('Mod+K')).toBe(true);
      expect(isValidHotkeyString('Alt+VolumeMute')).toBe(false);
    });
  });
});
