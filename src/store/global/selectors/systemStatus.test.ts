import { describe, expect, it, vi } from 'vitest';

import { merge } from '@/utils/merge';

import { type GlobalState } from '../initialState';
import { INITIAL_STATUS, initialState } from '../initialState';
import { DEFAULT_SIDEBAR_ITEMS, reorderSidebarItems, systemStatusSelectors } from './systemStatus';

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

  describe('sidebarItems', () => {
    it('should return DEFAULT_SIDEBAR_ITEMS when no data is set', () => {
      expect(systemStatusSelectors.sidebarItems(initialState)).toEqual(DEFAULT_SIDEBAR_ITEMS);
    });

    it('should return stored items when set', () => {
      const custom = ['agent', 'recents', 'pages', 'community', 'resource', 'memory'];
      const s: GlobalState = merge(initialState, {
        status: { sidebarItems: custom },
      });
      expect(systemStatusSelectors.sidebarItems(s)).toEqual(custom);
    });

    it('should append missing known keys to the end', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarItems: ['agent', 'recents'] },
      });
      const items = systemStatusSelectors.sidebarItems(s);
      // stored order preserved at the front
      expect(items.slice(0, 2)).toEqual(['agent', 'recents']);
      // every known key is present
      expect(items).toContain('pages');
      expect(items).toContain('community');
      expect(items).toContain('resource');
      expect(items).toContain('memory');
    });

    it('should migrate legacy `sidebarSectionOrder` accordion order into the default layout', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarSectionOrder: ['agent', 'recents'] },
      });
      const items = systemStatusSelectors.sidebarItems(s);
      // accordion slot in the default list now uses the user's legacy order
      expect(items).toEqual(['pages', 'agent', 'recents', 'community', 'resource', 'memory']);
    });

    it('should fall back to default when legacy `sidebarSectionOrder` is the default order', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarSectionOrder: ['recents', 'agent'] },
      });
      const items = systemStatusSelectors.sidebarItems(s);
      expect(items).toEqual(DEFAULT_SIDEBAR_ITEMS);
    });

    it('should prefer `sidebarItems` over legacy `sidebarSectionOrder` when both are set', () => {
      const s: GlobalState = merge(initialState, {
        status: {
          sidebarItems: ['pages', 'recents', 'agent', 'community', 'resource', 'memory'],
          sidebarSectionOrder: ['agent', 'recents'],
        },
      });
      const items = systemStatusSelectors.sidebarItems(s);
      expect(items.indexOf('recents')).toBeLessThan(items.indexOf('agent'));
    });
  });

  describe('reorderSidebarItems', () => {
    const DEFAULT = ['pages', 'recents', 'agent', 'community', 'resource', 'memory'];

    it('should move a non-accordion item normally', () => {
      // move `community` (idx 3) up to idx 0
      expect(reorderSidebarItems(DEFAULT, 3, 0)).toEqual([
        'community',
        'pages',
        'recents',
        'agent',
        'resource',
        'memory',
      ]);
    });

    it('should snap a non-accordion item out when dragged between accordion items (drag down)', () => {
      // `pages` (idx 0) dragged down to idx 2 (between recents & agent)
      // after drag-down: push past the accordion block
      expect(reorderSidebarItems(DEFAULT, 0, 2)).toEqual([
        'recents',
        'agent',
        'pages',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should snap a non-accordion item out when dragged between accordion items (drag up)', () => {
      // `community` (idx 3) dragged up to idx 2 (between recents & agent)
      // after drag-up: place before the accordion block
      expect(reorderSidebarItems(DEFAULT, 3, 2)).toEqual([
        'pages',
        'community',
        'recents',
        'agent',
        'resource',
        'memory',
      ]);
    });

    it('should move the whole accordion block when moving `recents` up past the block boundary', () => {
      // `recents` (idx 1) moveUp → idx 0. Block [recents, agent] slides to top.
      expect(reorderSidebarItems(DEFAULT, 1, 0)).toEqual([
        'recents',
        'agent',
        'pages',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should move the whole accordion block when moving `agent` down past the block boundary', () => {
      // `agent` (idx 2) moveDown → idx 3. Block slides past community.
      expect(reorderSidebarItems(DEFAULT, 2, 3)).toEqual([
        'pages',
        'community',
        'recents',
        'agent',
        'resource',
        'memory',
      ]);
    });

    it('should swap recents and agent within the block', () => {
      // `recents` (idx 1) moveDown → idx 2. Within block, so just swap.
      expect(reorderSidebarItems(DEFAULT, 1, 2)).toEqual([
        'pages',
        'agent',
        'recents',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should be a no-op when from === to', () => {
      expect(reorderSidebarItems(DEFAULT, 2, 2)).toBe(DEFAULT);
    });
  });
});
