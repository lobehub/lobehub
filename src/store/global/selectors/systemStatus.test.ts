import { describe, expect, it, vi } from 'vitest';

import { merge } from '@/utils/merge';

import type { GlobalState } from '../initialState';
import {
  DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS,
  DEFAULT_MODEL_DETAIL_PANEL_EXPANDED_KEYS,
  INITIAL_STATUS,
  initialState,
} from '../initialState';
import {
  DEFAULT_SIDEBAR_ITEMS,
  reorderSidebarItems,
  SIDEBAR_SPACER_ID,
  systemStatusSelectors,
} from './systemStatus';

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
        showAgentBuilderPanel: true,
        showRightPanel: true,
        showLeftPanel: true,
        showFilePanel: true,
        hidePWAInstaller: true,
        isShowCredit: true,
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
      expect(systemStatusSelectors.showAgentBuilderPanel(s)).toBe(true);
      expect(systemStatusSelectors.showRightPanel(s)).toBe(true);
      expect(systemStatusSelectors.showLeftPanel(s)).toBe(true);
      expect(systemStatusSelectors.showFilePanel(s)).toBe(true);
      expect(systemStatusSelectors.hidePWAInstaller(s)).toBe(true);
      expect(systemStatusSelectors.isShowCredit(s)).toBe(true);
      expect(systemStatusSelectors.leftPanelWidth(s)).toBe(300);
      expect(systemStatusSelectors.portalWidth(s)).toBe(500);
      expect(systemStatusSelectors.filePanelWidth(s)).toBe(400);
      expect(systemStatusSelectors.wideScreen(s)).toBe(false);
    });

    it('should return default portal width if not set', () => {
      const noPortalWidth = merge(initialState, {
        status: { portalWidth: undefined },
      });
      expect(systemStatusSelectors.portalWidth(noPortalWidth)).toBe(400);
    });

    it('should clamp persisted left panel width to the draggable panel bounds', () => {
      expect(
        systemStatusSelectors.leftPanelWidth(
          merge(initialState, {
            status: { leftPanelWidth: 120 },
          }),
        ),
      ).toBe(240);

      expect(
        systemStatusSelectors.leftPanelWidth(
          merge(initialState, {
            status: { leftPanelWidth: 720 },
          }),
        ),
      ).toBe(400);

      expect(
        systemStatusSelectors.leftPanelWidth(
          merge(initialState, {
            status: { leftPanelWidth: '360px' as unknown as number },
          }),
        ),
      ).toBe(360);
    });
  });

  describe('modelDetailPanelExpandedKeys', () => {
    it('should expand pricing and config by default', () => {
      const s: GlobalState = {
        ...initialState,
        status: {
          ...initialState.status,
          modelDetailPanelExpandedKeys: undefined,
        },
      };

      expect(systemStatusSelectors.modelDetailPanelExpandedKeys(s)).toEqual(
        DEFAULT_MODEL_DETAIL_PANEL_EXPANDED_KEYS,
      );
    });

    it('should return stored user preference when set', () => {
      const s: GlobalState = merge(initialState, {
        status: {
          modelDetailPanelExpandedKeys: ['pricing'],
        },
      });

      expect(systemStatusSelectors.modelDetailPanelExpandedKeys(s)).toEqual(['pricing']);
    });
  });

  describe('sidebarItems', () => {
    it('should return DEFAULT_SIDEBAR_ITEMS when no data is set', () => {
      expect(systemStatusSelectors.sidebarItems(initialState)).toEqual(DEFAULT_SIDEBAR_ITEMS);
    });

    it('should re-anchor the spacer immediately after the accordion block', () => {
      // Stored order has pages/tasks between the accordion and the first default-bottom item.
      // The invariant moves them into the bottom group (after the spacer).
      const stored = [
        'agent',
        'recents',
        'pages',
        'tasks',
        'image',
        'community',
        'resource',
        'memory',
      ];
      const s: GlobalState = merge(initialState, {
        status: { sidebarItems: stored },
      });
      expect(systemStatusSelectors.sidebarItems(s)).toEqual([
        'agent',
        'recents',
        SIDEBAR_SPACER_ID,
        'pages',
        'tasks',
        'image',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should preserve a canonically-positioned spacer', () => {
      const stored = [
        'pages',
        'recents',
        'agent',
        SIDEBAR_SPACER_ID,
        'image',
        'tasks',
        'community',
        'resource',
        'memory',
      ];
      const s: GlobalState = merge(initialState, {
        status: { sidebarItems: stored },
      });
      expect(systemStatusSelectors.sidebarItems(s)).toEqual(stored);
    });

    it('should re-anchor the spacer when stored above the accordion', () => {
      // Simulates the dropdown-menu "move agent down" path that previously left
      // the spacer floating above the accordion block.
      const stored = [
        'tasks',
        'pages',
        SIDEBAR_SPACER_ID,
        'recents',
        'agent',
        'image',
        'community',
        'resource',
        'memory',
      ];
      const s: GlobalState = merge(initialState, {
        status: { sidebarItems: stored },
      });
      expect(systemStatusSelectors.sidebarItems(s)).toEqual([
        'tasks',
        'pages',
        'recents',
        'agent',
        SIDEBAR_SPACER_ID,
        'image',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should slot missing top-group defaults before the accordion block', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarItems: ['agent', 'recents'] },
      });
      const items = systemStatusSelectors.sidebarItems(s);
      const spacerIdx = items.indexOf(SIDEBAR_SPACER_ID);
      // every known key is present
      expect(items).toContain('pages');
      expect(items).toContain('tasks');
      expect(items).toContain('community');
      expect(items).toContain('resource');
      expect(items).toContain('memory');
      // accordion block is flush against the spacer, in stored order
      expect(items[spacerIdx - 2]).toBe('agent');
      expect(items[spacerIdx - 1]).toBe('recents');
      // missing top-group defaults slot in just before the accordion
      expect(items.indexOf('tasks')).toBeLessThan(spacerIdx - 2);
      expect(items.indexOf('pages')).toBeLessThan(spacerIdx - 2);
      // missing bottom-group defaults sit after the spacer
      expect(items.indexOf('image')).toBeGreaterThan(spacerIdx);
    });

    it('should migrate legacy `sidebarSectionOrder` accordion order into the default layout', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarSectionOrder: ['agent', 'recents'] },
      });
      const items = systemStatusSelectors.sidebarItems(s);
      // accordion slot in the default list now uses the user's legacy order
      expect(items).toEqual([
        'tasks',
        'pages',
        'agent',
        'recents',
        SIDEBAR_SPACER_ID,
        'image',
        'community',
        'resource',
        'memory',
      ]);
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

  describe('sidebarExpandedKeys', () => {
    it('should expand sidebar accordion sections by default', () => {
      const s: GlobalState = {
        ...initialState,
        status: {
          ...initialState.status,
          sidebarExpandedKeys: undefined,
        },
      };

      expect(systemStatusSelectors.sidebarExpandedKeys(s)).toEqual(
        DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS,
      );
    });

    it('should preserve an empty stored preference when all sections are collapsed', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarExpandedKeys: [] },
      });

      expect(systemStatusSelectors.sidebarExpandedKeys(s)).toEqual([]);
    });
  });

  describe('reorderSidebarItems', () => {
    // Mirrors the shape returned by the sidebarItems selector — spacer is always
    // present, anchored immediately after the accordion block.
    const DEFAULT = [
      'pages',
      'recents',
      'agent',
      SIDEBAR_SPACER_ID,
      'community',
      'resource',
      'memory',
    ];

    it('should move a non-accordion item normally', () => {
      // move `community` (idx 4) up to idx 0
      expect(reorderSidebarItems(DEFAULT, 4, 0)).toEqual([
        'community',
        'pages',
        'recents',
        'agent',
        SIDEBAR_SPACER_ID,
        'resource',
        'memory',
      ]);
    });

    it('should snap a top-group item past the accordion when dragged between accordion items (drag down)', () => {
      // `pages` (idx 0) dragged down to idx 2 (between recents & agent) →
      // pushed past the accordion, lands in the bottom group.
      expect(reorderSidebarItems(DEFAULT, 0, 2)).toEqual([
        'recents',
        'agent',
        SIDEBAR_SPACER_ID,
        'pages',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should snap a bottom-group item before the accordion when dragged between accordion items (drag up)', () => {
      // `community` (idx 4) dragged up to idx 2 (between recents & agent) →
      // lands ahead of the accordion (top group).
      expect(reorderSidebarItems(DEFAULT, 4, 2)).toEqual([
        'pages',
        'community',
        'recents',
        'agent',
        SIDEBAR_SPACER_ID,
        'resource',
        'memory',
      ]);
    });

    it('should move the whole accordion block when moving `recents` up past the block boundary', () => {
      // `recents` (idx 1) moveUp → idx 0. Block [recents, agent] slides to top,
      // spacer follows it.
      expect(reorderSidebarItems(DEFAULT, 1, 0)).toEqual([
        'recents',
        'agent',
        SIDEBAR_SPACER_ID,
        'pages',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should snap the accordion back when moving `agent` down past the spacer', () => {
      // `agent` (idx 2) moveDown → idx 3 (past spacer). Normalization re-anchors
      // the spacer behind the accordion, making the move a visible no-op.
      expect(reorderSidebarItems(DEFAULT, 2, 3)).toBe(DEFAULT);
    });

    it('should swap recents and agent within the block', () => {
      // `recents` (idx 1) moveDown → idx 2. Within block, so just swap.
      expect(reorderSidebarItems(DEFAULT, 1, 2)).toEqual([
        'pages',
        'agent',
        'recents',
        SIDEBAR_SPACER_ID,
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should be a no-op when from === to', () => {
      expect(reorderSidebarItems(DEFAULT, 2, 2)).toBe(DEFAULT);
    });

    it('should keep the spacer behind the accordion after moving a non-accordion item', () => {
      const items = [
        'tasks',
        'pages',
        'recents',
        'agent',
        SIDEBAR_SPACER_ID,
        'image',
        'community',
        'resource',
        'memory',
      ];
      // Move `pages` (idx 1) to the very end. Spacer stays right after `agent`.
      const next = reorderSidebarItems(items, 1, items.length - 1);
      const spacerIdx = next.indexOf(SIDEBAR_SPACER_ID);
      expect(next[spacerIdx - 1]).toBe('agent');
      expect(next[spacerIdx - 2]).toBe('recents');
      expect(next.at(-1)).toBe('pages');
    });
  });
});
