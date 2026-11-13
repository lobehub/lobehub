import { describe, expect, it } from 'vitest';

import { merge } from '@/utils/merge';

import type { GlobalState } from '../initialState';
import { DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS, initialState } from '../initialState';
import {
  DEFAULT_SIDEBAR_ITEMS,
  normalizeLegacyAgentItems,
  normalizeLegacyExpandedKeys,
  normalizeLegacyHiddenSections,
  SIDEBAR_ACCORDION_KEYS,
  SIDEBAR_SPACER_ID,
  systemStatusSelectors,
} from './systemStatus';

// The workspace "Private" accordion (`private`) was merged into the single
// "Agents" section (`agent`). Saved layouts from before must keep working.
describe('legacy `private` sidebar key', () => {
  describe('normalizeLegacyAgentItems', () => {
    it('drops `private` when `agent` is already in the order', () => {
      expect(normalizeLegacyAgentItems(['recents', 'private', 'agent', 'image'])).toEqual([
        'recents',
        'agent',
        'image',
      ]);
    });

    it('puts `agent` where `private` was when the order has no `agent`', () => {
      expect(normalizeLegacyAgentItems(['tasks', 'private', 'recents'])).toEqual([
        'tasks',
        'agent',
        'recents',
      ]);
    });

    it('returns the same reference when there is nothing to migrate', () => {
      const items = ['recents', 'agent'];
      expect(normalizeLegacyAgentItems(items)).toBe(items);
    });
  });

  it('drops `private` from hidden sections (Agents is always shown)', () => {
    expect(normalizeLegacyHiddenSections(['recents', 'private'])).toEqual(['recents']);
    const untouched = ['recents'];
    expect(normalizeLegacyHiddenSections(untouched)).toBe(untouched);
  });

  it('keeps Agents expanded when either former section was expanded', () => {
    expect(normalizeLegacyExpandedKeys(['recents', 'private'])).toEqual(['recents', 'agent']);
    expect(normalizeLegacyExpandedKeys(['agent', 'private'])).toEqual(['agent']);
    const untouched = ['recents'];
    expect(normalizeLegacyExpandedKeys(untouched)).toBe(untouched);
  });

  it('no longer ships `private` in the defaults', () => {
    expect(DEFAULT_SIDEBAR_ITEMS).not.toContain('private');
    expect([...SIDEBAR_ACCORDION_KEYS]).not.toContain('private');
    expect(DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS).not.toContain('private');
  });

  describe('selectors', () => {
    const legacyWorkspace: GlobalState = merge(initialState, {
      status: {
        workspace: {
          hiddenSidebarSections: ['recents', 'private'],
          sidebarExpandedKeys: ['favorites', 'private'],
          sidebarItems: [
            'tasks',
            'favorites',
            'recents',
            'private',
            'agent',
            SIDEBAR_SPACER_ID,
            'image',
          ],
        },
      },
    });

    it('renders exactly one Agents section for a saved workspace layout', () => {
      const items = systemStatusSelectors.sidebarItems('ws-1')(legacyWorkspace);

      expect(items).not.toContain('private');
      expect(items.filter((key) => key === 'agent')).toHaveLength(1);
      // Stays in the accordion block, right above the spacer.
      expect(items[items.indexOf(SIDEBAR_SPACER_ID) - 1]).toBe('agent');
    });

    it('does not resurrect `private` through the missing-key backfill', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarItems: ['private', 'recents'] },
      });
      const items = systemStatusSelectors.sidebarItems(null)(s);

      expect(items).not.toContain('private');
      expect(items.filter((key) => key === 'agent')).toHaveLength(1);
    });

    it('normalizes hidden and expanded keys', () => {
      expect(systemStatusSelectors.hiddenSidebarSections('ws-1')(legacyWorkspace)).toEqual([
        'recents',
      ]);
      expect(systemStatusSelectors.sidebarExpandedKeys('ws-1')(legacyWorkspace)).toEqual([
        'favorites',
        'agent',
      ]);
    });

    it('normalizes a legacy `sidebarSectionOrder` too', () => {
      const s: GlobalState = merge(initialState, {
        status: { sidebarSectionOrder: ['private', 'recents'] },
      });
      const items = systemStatusSelectors.sidebarItems(null)(s);

      expect(items).not.toContain('private');
      expect(items.indexOf('agent')).toBeLessThan(items.indexOf('recents'));
    });
  });
});
