import { describe, expect, it } from 'vitest';

import { SIDEBAR_SPACER_ID } from '@/store/global/selectors/systemStatus';

import { getAvailableSidebarItems, getSortableSidebarItemIds } from './CustomizeSidebarModal';

describe('CustomizeSidebarModal', () => {
  it('keeps Memory available in personal mode', () => {
    const items = getAvailableSidebarItems(false);

    expect(items.some((item) => item.id === 'memory')).toBe(true);
  });

  it('allows Projects to be reordered and hidden', () => {
    expect(getAvailableSidebarItems(false).some((item) => item.id === 'project')).toBe(true);
    expect(getSortableSidebarItemIds(false).has('project')).toBe(true);
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

  it('offers Dashboards only while the dashboard flag is on, and never in workspace mode', () => {
    expect(getSortableSidebarItemIds(false).has('dashboard')).toBe(false);
    expect(getSortableSidebarItemIds(false, { dashboardEnabled: true }).has('dashboard')).toBe(
      true,
    );
    expect(getSortableSidebarItemIds(true, { dashboardEnabled: true }).has('dashboard')).toBe(
      false,
    );
  });

  it.each([false, true])(
    'shows the separate Goals option only in workspace mode (%s)',
    (workspace) => {
      expect(getSortableSidebarItemIds(workspace).has('goals')).toBe(workspace);
      expect(getSortableSidebarItemIds(workspace).has('tasks')).toBe(true);
    },
  );

  it('offers Channels, hideable, only while Channels are enabled', () => {
    expect(getSortableSidebarItemIds(false).has('channels')).toBe(false);
    expect(getSortableSidebarItemIds(false, { channelsEnabled: true }).has('channels')).toBe(true);
    expect(getSortableSidebarItemIds(true, { channelsEnabled: true }).has('channels')).toBe(true);

    const channels = getAvailableSidebarItems(true, { channelsEnabled: true }).find(
      (item) => item.id === 'channels',
    );
    expect(channels).toMatchObject({ labelKey: 'title', labelNs: 'channel' });
    expect(channels?.alwaysVisible).toBeUndefined();
  });
});
