import { describe, expect, it } from 'vitest';

import { getAvailableSidebarItems, getSortableSidebarItemIds } from './CustomizeSidebarModal';

describe('CustomizeSidebarModal', () => {
  it('allows Projects to be reordered and hidden', () => {
    expect(getAvailableSidebarItems(false).some((item) => item.id === 'project')).toBe(true);
    expect(getSortableSidebarItemIds(false).has('project')).toBe(true);
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

  it.each([false, true])('offers one combined Tasks entry (workspace: %s)', (workspace) => {
    expect(getSortableSidebarItemIds(workspace).has('goals')).toBe(false);
    expect(getAvailableSidebarItems(workspace).find((item) => item.id === 'tasks')).toMatchObject({
      labelKey: 'tab.goalsAndTasks',
      labelNs: 'chat',
    });
  });

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
