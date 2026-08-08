import { describe, expect, it } from 'vitest';

import { SIDEBAR_SPACER_ID } from '@/store/global/selectors/systemStatus';

import { getAvailableSidebarItems, getSortableSidebarItemIds } from './CustomizeSidebarModal';

describe('CustomizeSidebarModal', () => {
  it('keeps Memory available in personal mode', () => {
    const items = getAvailableSidebarItems(false);

    expect(items.some((item) => item.id === 'memory')).toBe(true);
  });

  it('removes Memory from workspace mode customization', () => {
    const items = getAvailableSidebarItems(true);

    expect(items.some((item) => item.id === 'memory')).toBe(false);
  });

  it('keeps the spacer in the sortable item set', () => {
    expect(getSortableSidebarItemIds(false).has(SIDEBAR_SPACER_ID)).toBe(true);
    expect(getSortableSidebarItemIds(true).has(SIDEBAR_SPACER_ID)).toBe(true);
  });

  it('keeps workspace-only exclusions in the sortable item set', () => {
    expect(getSortableSidebarItemIds(false).has('memory')).toBe(true);
    expect(getSortableSidebarItemIds(true).has('memory')).toBe(false);
  });
});
