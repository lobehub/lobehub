import { describe, expect, it } from 'vitest';

import { type ElectronState } from '@/store/electron/initialState';
import { initialState } from '@/store/electron/initialState';
import { merge } from '@/utils/merge';

import { desktopStateSelectors } from '../desktopState';

describe('desktopStateSelectors', () => {
  describe('userPath', () => {
    it('should return userPath from appState', () => {
      const state: ElectronState = merge(initialState, {
        appState: {
          userPath: {
            desktop: '/test/desktop',
            documents: '/test/documents',
            downloads: '/test/downloads',
            home: '/test/home',
            music: '/test/music',
            pictures: '/test/pictures',
            userData: '/test/userdata',
            videos: '/test/videos',
          },
        },
      });

      expect(desktopStateSelectors.userPath(state)).toEqual({
        desktop: '/test/desktop',
        documents: '/test/documents',
        downloads: '/test/downloads',
        home: '/test/home',
        music: '/test/music',
        pictures: '/test/pictures',
        userData: '/test/userdata',
        videos: '/test/videos',
      });
    });

    it('should handle undefined userPath', () => {
      const state: ElectronState = merge(initialState, {
        appState: {},
      });

      expect(desktopStateSelectors.userPath(state)).toBeUndefined();
    });
  });
});
