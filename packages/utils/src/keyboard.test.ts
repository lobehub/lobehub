import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCommandPressed } from './keyboard';
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
});
