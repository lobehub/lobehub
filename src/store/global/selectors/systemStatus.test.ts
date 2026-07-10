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
  readOverridableField,
  reorderSidebarItems,
  routeOverlayWrites,
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
      expect(systemStatusSelectors.sessionGroupKeys(null)(s)).toEqual(['group1', 'group2']);
    });

    it('should return initial value if not set', () => {
      const s: GlobalState = merge(initialState, {
        status: {
          expandSessionGroupKeys: undefined,
        },
      });
      expect(systemStatusSelectors.sessionGroupKeys(null)(s)).toEqual(
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
      expect(systemStatusSelectors.sidebarItems(null)(initialState)).toEqual(DEFAULT_SIDEBAR_ITEMS);
    });

    it('should re-anchor the spacer immediately after the accordion block', () => {
      // Stored order has pages/tasks between the accordion and the first default-bottom item.
      // The invariant moves them into the bottom group (after the spacer).
      const stored = [
        'private',
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
      expect(systemStatusSelectors.sidebarItems(null)(s)).toEqual([
        'private',
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
        'private',
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
      expect(systemStatusSelectors.sidebarItems(null)(s)).toEqual(stored);
    });

    it('should re-anchor the spacer when stored above the accordion', () => {
      // Simulates the dropdown-menu "move agent down" path that previously left
      // the spacer floating above the accordion block.
      const stored = [
        'tasks',
        'pages',
        SIDEBAR_SPACER_ID,
        'recents',
        'private',
        'agent',
        'image',
        'community',
        'resource',
        'memory',
      ];
      const s: GlobalState = merge(initialState, {
        status: { sidebarItems: stored },
      });
      expect(systemStatusSelectors.sidebarItems(null)(s)).toEqual([
        'tasks',
        'pages',
        'recents',
        'private',
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
      const items = systemStatusSelectors.sidebarItems(null)(s);
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
      const items = systemStatusSelectors.sidebarItems(null)(s);
      // accordion slot uses the user's legacy order; `private` (added after
      // the legacy state was saved) is backfilled at the head of the block.
      expect(items).toEqual([
        'tasks',
        'pages',
        'private',
        'agent',
        'recents',
        SIDEBAR_SPACER_ID,
        'image',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should preserve legacy accordion order when migrating from `sidebarSectionOrder`', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarSectionOrder: ['recents', 'agent'] },
      });
      const items = systemStatusSelectors.sidebarItems(null)(s);
      // `private` (new accordion entry not present in legacy state) is
      // backfilled at the head of the block; recents/agent keep legacy order.
      expect(items).toEqual([
        'tasks',
        'pages',
        'private',
        'recents',
        'agent',
        SIDEBAR_SPACER_ID,
        'image',
        'community',
        'resource',
        'memory',
      ]);
    });

    it('should prefer `sidebarItems` over legacy `sidebarSectionOrder` when both are set', () => {
      const s: GlobalState = merge(initialState, {
        status: {
          sidebarItems: ['pages', 'recents', 'agent', 'community', 'resource', 'memory'],
          sidebarSectionOrder: ['agent', 'recents'],
        },
      });
      const items = systemStatusSelectors.sidebarItems(null)(s);
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

      expect(systemStatusSelectors.sidebarExpandedKeys(null)(s)).toEqual(
        DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS,
      );
    });

    it('should preserve an empty stored preference when all sections are collapsed', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarExpandedKeys: [] },
      });

      expect(systemStatusSelectors.sidebarExpandedKeys(null)(s)).toEqual([]);
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

  describe('workspace overlay', () => {
    describe('readOverridableField', () => {
      it('returns the top-level value when workspaceId is null', () => {
        const status = {
          ...initialState.status,
          expandSessionGroupKeys: ['personal'],
          workspace: { expandSessionGroupKeys: ['ws'] },
        };
        expect(readOverridableField(status, 'expandSessionGroupKeys', null)).toEqual(['personal']);
      });

      it('returns the overlay value when workspaceId is set and overlay carries the field', () => {
        const status = {
          ...initialState.status,
          expandSessionGroupKeys: ['personal'],
          workspace: { expandSessionGroupKeys: ['ws'] },
        };
        expect(readOverridableField(status, 'expandSessionGroupKeys', 'ws-1')).toEqual(['ws']);
      });

      it('falls back to top-level when overlay is missing the field', () => {
        const status = {
          ...initialState.status,
          hiddenSidebarSections: ['recents'],
          workspace: { expandSessionGroupKeys: ['ws'] },
        };
        expect(readOverridableField(status, 'hiddenSidebarSections', 'ws-1')).toEqual(['recents']);
      });
    });

    describe('selectors honour the overlay', () => {
      const stateWithOverlay: GlobalState = merge(initialState, {
        status: {
          expandSessionGroupKeys: ['personal-group'],
          hiddenSidebarSections: [],
          sidebarItems: undefined,
          sidebarExpandedKeys: ['recents', 'agent', 'private'],
          workspace: {
            expandSessionGroupKeys: ['ws-group'],
            hiddenSidebarSections: ['recents'],
            sidebarExpandedKeys: ['agent'],
          },
        },
      });

      it('sessionGroupKeys prefers overlay in workspace mode', () => {
        expect(systemStatusSelectors.sessionGroupKeys('ws-1')(stateWithOverlay)).toEqual([
          'ws-group',
        ]);
      });

      it('sessionGroupKeys returns personal value in personal mode', () => {
        expect(systemStatusSelectors.sessionGroupKeys(null)(stateWithOverlay)).toEqual([
          'personal-group',
        ]);
      });

      it('hiddenSidebarSections prefers overlay in workspace mode', () => {
        expect(systemStatusSelectors.hiddenSidebarSections('ws-1')(stateWithOverlay)).toEqual([
          'recents',
        ]);
      });

      it('sidebarExpandedKeys prefers overlay in workspace mode', () => {
        expect(systemStatusSelectors.sidebarExpandedKeys('ws-1')(stateWithOverlay)).toEqual([
          'agent',
        ]);
      });

      it('sidebarItems falls back to default when overlay omits and top-level omits', () => {
        // Both top-level and workspace.sidebarItems are undefined → default
        expect(systemStatusSelectors.sidebarItems('ws-1')(stateWithOverlay)).toEqual(
          DEFAULT_SIDEBAR_ITEMS,
        );
      });

      it('hides `recents` by default in workspace mode when overlay is untouched', () => {
        const s: GlobalState = merge(initialState, {
          status: { hiddenSidebarSections: undefined, workspace: undefined },
        });
        expect(systemStatusSelectors.hiddenSidebarSections('ws-1')(s)).toEqual(['recents']);
      });

      it('keeps `recents` visible in personal mode by default', () => {
        const s: GlobalState = merge(initialState, {
          status: { hiddenSidebarSections: undefined, workspace: undefined },
        });
        expect(systemStatusSelectors.hiddenSidebarSections(null)(s)).toEqual([]);
      });

      it('layers workspace defaults on top of personal-mode hides when overlay is untouched', () => {
        const s: GlobalState = merge(initialState, {
          status: { hiddenSidebarSections: ['pages'], workspace: undefined },
        });
        expect(systemStatusSelectors.hiddenSidebarSections('ws-1')(s)).toEqual([
          'pages',
          'recents',
        ]);
      });

      it('respects an explicit empty overlay as "show everything in this workspace"', () => {
        const s: GlobalState = merge(initialState, {
          status: { hiddenSidebarSections: ['recents'], workspace: { hiddenSidebarSections: [] } },
        });
        expect(systemStatusSelectors.hiddenSidebarSections('ws-1')(s)).toEqual([]);
      });
    });

    describe('routeOverlayWrites', () => {
      it('passes patch through unchanged when workspaceId is null', () => {
        const patch = { hiddenSidebarSections: ['recents'], leftPanelWidth: 300 };
        expect(routeOverlayWrites(patch, null)).toBe(patch);
      });

      it('routes whitelisted fields into the workspace overlay', () => {
        const patch = { hiddenSidebarSections: ['recents'], expandSessionGroupKeys: ['x'] };
        expect(routeOverlayWrites(patch, 'ws-1')).toEqual({
          workspace: {
            hiddenSidebarSections: ['recents'],
            expandSessionGroupKeys: ['x'],
          },
        });
      });

      it('keeps non-whitelisted fields at the top level even in workspace mode', () => {
        const patch = { leftPanelWidth: 300, language: 'zh-CN' as const };
        expect(routeOverlayWrites(patch, 'ws-1')).toEqual({
          leftPanelWidth: 300,
          language: 'zh-CN',
        });
      });

      it('splits a mixed patch into top-level and workspace overlay', () => {
        const patch = {
          leftPanelWidth: 300,
          hiddenSidebarSections: ['recents'],
          sidebarItems: ['agent'],
        };
        expect(routeOverlayWrites(patch, 'ws-1')).toEqual({
          leftPanelWidth: 300,
          workspace: {
            hiddenSidebarSections: ['recents'],
            sidebarItems: ['agent'],
          },
        });
      });

      it('preserves an explicit `workspace` key while routing whitelisted fields', () => {
        const patch = {
          hiddenSidebarSections: ['recents'],
          workspace: { sidebarItems: ['existing'] as string[] },
        };
        expect(routeOverlayWrites(patch, 'ws-1')).toEqual({
          workspace: {
            sidebarItems: ['existing'],
            hiddenSidebarSections: ['recents'],
          },
        });
      });
    });
  });
});
