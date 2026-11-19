import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSidebarSectionMenuItems } from './useSidebarSectionMenuItems';

const mocks = vi.hoisted(() => ({
  channelsEnabled: true,
  openCustomizeSidebarModal: vi.fn(),
  status: {} as { hiddenSidebarSections?: string[]; sidebarItems?: string[] },
  updateSystemStatus: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) =>
    selector({ status: mocks.status, updateSystemStatus: mocks.updateSystemStatus }),
}));
vi.mock('@/features/Channels/useChannelsEnabled', () => ({
  useChannelsEnabled: () => mocks.channelsEnabled,
}));
vi.mock('./CustomizeSidebarModal', () => ({
  openCustomizeSidebarModal: mocks.openCustomizeSidebarModal,
}));

type MenuItem = { disabled?: boolean; key?: string; onClick?: () => void; type?: string };

const itemsFor = (key: string) =>
  renderHook(() => useSidebarSectionMenuItems(key)).result.current as MenuItem[];
const find = (items: MenuItem[], key: string) => items.find((item) => item.key === key)!;

describe('useSidebarSectionMenuItems', () => {
  beforeEach(() => {
    mocks.channelsEnabled = true;
    mocks.openCustomizeSidebarModal.mockReset();
    mocks.updateSystemStatus.mockReset();
    mocks.status = {
      hiddenSidebarSections: [],
      sidebarItems: ['tasks', 'favorites', 'recents', 'agent', 'channels', '__spacer__', 'image'],
    };
  });

  it('offers move, hide and customize sidebar', () => {
    expect(itemsFor('channels').map((item) => item.key ?? item.type)).toEqual([
      'moveUp',
      'moveDown',
      'hideSection',
      'divider',
      'customizeSidebar',
    ]);
  });

  it('moves the section within the accordion block', () => {
    const moveUp = find(itemsFor('channels'), 'moveUp');
    act(() => moveUp.onClick!());

    const { sidebarItems } = mocks.updateSystemStatus.mock.calls[0][0] as {
      sidebarItems: string[];
    };
    const spacerIndex = sidebarItems.indexOf('__spacer__');
    expect(sidebarItems.slice(spacerIndex - 4, spacerIndex)).toEqual([
      'favorites',
      'recents',
      'channels',
      'agent',
    ]);
  });

  it('hides the section', () => {
    mocks.status.hiddenSidebarSections = ['recents'];

    const hide = find(itemsFor('favorites'), 'hideSection');
    act(() => hide.onClick!());

    expect(mocks.updateSystemStatus).toHaveBeenCalledWith({
      hiddenSidebarSections: ['recents', 'favorites'],
    });
  });

  it('opens the customize sidebar modal', () => {
    const customize = find(itemsFor('favorites'), 'customizeSidebar');
    act(() => customize.onClick!());

    expect(mocks.openCustomizeSidebarModal).toHaveBeenCalled();
  });

  it('disables moving past the ends of the visible sections', () => {
    expect(find(itemsFor('tasks'), 'moveUp').disabled).toBe(true);
    expect(find(itemsFor('tasks'), 'moveDown').disabled).toBe(false);

    // The spacer stays flush below the section block, so its last section cannot move down.
    expect(find(itemsFor('channels'), 'moveDown').disabled).toBe(true);
    expect(find(itemsFor('agent'), 'moveDown').disabled).toBe(false);

    mocks.channelsEnabled = false;
    expect(find(itemsFor('agent'), 'moveDown').disabled).toBe(true);
  });

  it('steps over hidden sections and Channels while they are off', () => {
    mocks.channelsEnabled = false;
    mocks.status = {
      hiddenSidebarSections: ['recents'],
      sidebarItems: ['tasks', 'agent', 'recents', 'channels', 'favorites', '__spacer__', 'image'],
    };

    const moveUp = find(itemsFor('favorites'), 'moveUp');
    act(() => moveUp.onClick!());

    const { sidebarItems } = mocks.updateSystemStatus.mock.calls[0][0] as {
      sidebarItems: string[];
    };
    expect(sidebarItems.indexOf('favorites')).toBeLessThan(sidebarItems.indexOf('agent'));
  });
});
