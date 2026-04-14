import { describe, expect, it, vi } from 'vitest';

import { merge } from '@/utils/merge';

import { type GlobalState } from '../initialState';
import { INITIAL_STATUS, initialState } from '../initialState';
import { DEFAULT_ZONES, systemStatusSelectors } from './systemStatus';

// Mock version constants
vi.mock('@/const/version', () => ({
  isServerMode: false,
  isUsePgliteDB: true,
}));

describe('systemStatusSelectors', () => {
  describe('sessionGroupKeys', () => {
    it('should return expandSessionGroupKeys from status', () => {
      const s: GlobalState = merge(initialState, {
        status: {
          expandSessionGroupKeys: ['group1', 'group2'],
        },
      });
      expect(systemStatusSelectors.sessionGroupKeys(s)).toEqual(['group1', 'group2']);
    });

    it('should return initial value if not set', () => {
      const s: GlobalState = merge(initialState, {
        status: {
          expandSessionGroupKeys: undefined,
        },
      });
      expect(systemStatusSelectors.sessionGroupKeys(s)).toEqual(
        INITIAL_STATUS.expandSessionGroupKeys,
      );
    });
  });

  describe('basic selectors', () => {
    const s: GlobalState = merge(initialState, {
      status: {
        showSystemRole: true,
        mobileShowTopic: true,
        mobileShowPortal: true,
        showRightPanel: true,
        showLeftPanel: true,
        showFilePanel: true,
        hidePWAInstaller: true,
        isShowCredit: true,
        zenMode: false,
        leftPanelWidth: 300,
        portalWidth: 500,
        filePanelWidth: 400,
        inputHeight: 150,
        threadInputHeight: 100,
      },
    });

    it('should return correct values for basic selectors', () => {
      expect(systemStatusSelectors.showSystemRole(s)).toBe(true);
      expect(systemStatusSelectors.mobileShowTopic(s)).toBe(true);
      expect(systemStatusSelectors.mobileShowPortal(s)).toBe(true);
      expect(systemStatusSelectors.showRightPanel(s)).toBe(true);
      expect(systemStatusSelectors.showLeftPanel(s)).toBe(true);
      expect(systemStatusSelectors.showFilePanel(s)).toBe(true);
      expect(systemStatusSelectors.hidePWAInstaller(s)).toBe(true);
      expect(systemStatusSelectors.isShowCredit(s)).toBe(true);
      expect(systemStatusSelectors.showChatHeader(s)).toBe(true);
      expect(systemStatusSelectors.inZenMode(s)).toBe(false);
      expect(systemStatusSelectors.leftPanelWidth(s)).toBe(300);
      expect(systemStatusSelectors.portalWidth(s)).toBe(500);
      expect(systemStatusSelectors.filePanelWidth(s)).toBe(400);
      expect(systemStatusSelectors.wideScreen(s)).toBe(false);
    });

    it('should handle zen mode effects', () => {
      const zenState = merge(s, {
        status: { zenMode: true },
      });
      expect(systemStatusSelectors.showRightPanel(zenState)).toBe(false);
      expect(systemStatusSelectors.showLeftPanel(zenState)).toBe(false);
      expect(systemStatusSelectors.showChatHeader(zenState)).toBe(false);
    });

    it('should return default portal width if not set', () => {
      const noPortalWidth = merge(initialState, {
        status: { portalWidth: undefined },
      });
      expect(systemStatusSelectors.portalWidth(noPortalWidth)).toBe(400);
    });
  });

  describe('sidebarZones', () => {
    it('should return DEFAULT_ZONES when no data is set', () => {
      expect(systemStatusSelectors.sidebarZones(initialState)).toEqual(DEFAULT_ZONES);
    });

    it('should return stored zones when sidebarZones is complete', () => {
      const customZones = {
        bottom: ['memory', 'resource', 'community'],
        middle: ['agent', 'recents'],
        top: ['pages'],
      };
      const s: GlobalState = merge(initialState, {
        status: { sidebarZones: customZones },
      });
      expect(systemStatusSelectors.sidebarZones(s)).toEqual(customZones);
    });

    it('should place pages in top zone when migrating legacy order ["recents","agent"]', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarSectionOrder: ['recents', 'agent'] },
      });
      const zones = systemStatusSelectors.sidebarZones(s);
      expect(zones.top).toContain('pages');
      expect(zones.bottom).not.toContain('pages');
    });

    it('should preserve explicit legacy positions and seed missing keys into default zones', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarSectionOrder: ['community', 'recents', 'agent', 'resource'] },
      });
      const zones = systemStatusSelectors.sidebarZones(s);
      // community was explicitly placed before accordion → top
      expect(zones.top).toContain('community');
      // pages was missing → seeded into default top zone
      expect(zones.top).toContain('pages');
      // memory was missing → seeded into default bottom zone
      expect(zones.bottom).toContain('memory');
      // middle kept from legacy
      expect(zones.middle).toEqual(['recents', 'agent']);
    });
  });
});
