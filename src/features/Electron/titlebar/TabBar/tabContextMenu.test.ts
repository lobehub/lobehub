import { describe, expect, it, vi } from 'vitest';

import { canGoNative } from '@/libs/contextMenu/canGoNative';
import { toNativeTemplate } from '@/libs/contextMenu/toNativeTemplate';

import { buildTabContextMenuItems } from './tabContextMenu';

const build = (index: number, totalCount: number, pinned = false, pinnedCount = 0) =>
  buildTabContextMenuItems({
    id: 'tab-1',
    index,
    inSplitView: false,
    onClose: vi.fn(),
    onCloseLeft: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseRight: vi.fn(),
    onCloseSplitView: vi.fn(),
    onOpenInSplitView: vi.fn(),
    onTogglePin: vi.fn(),
    pinned,
    pinnedCount,
    splitViewEnabled: true,
    t: (key) => key,
    totalCount,
  });

const isDisabled = (items: ReturnType<typeof build>, key: string) => {
  const entry = items.find((item) => !!item && 'key' in item && item.key === key);
  return entry && 'disabled' in entry ? !!entry.disabled : false;
};

describe('tab context menu ownership', () => {
  it('goes native on macOS desktop (plain string labels, no web-only capabilities)', () => {
    const items = build(1, 3);

    expect(canGoNative(items)).toBe(true);
    expect(toNativeTemplate(items).template).toMatchSnapshot();
  });

  it('stays native-eligible in the fully disabled single-tab state', () => {
    expect(canGoNative(build(0, 1))).toBe(true);
  });
});

describe('pin entry', () => {
  it('offers pinning for an unpinned tab and unpinning for a pinned one', () => {
    const labelOf = (pinned: boolean) => {
      const entry = build(1, 3, pinned).find(
        (item) => !!item && 'key' in item && item.key === 'togglePin',
      );
      return entry && 'label' in entry ? entry.label : undefined;
    };

    expect(labelOf(false)).toBe('tab.pin');
    expect(labelOf(true)).toBe('tab.unpin');
  });

  it('stays available when closing is not — a lone tab can still be pinned', () => {
    const items = build(0, 1);
    const pin = items.find((item) => !!item && 'key' in item && item.key === 'togglePin');

    expect(pin && 'disabled' in pin ? pin.disabled : undefined).toBeFalsy();
  });
});

describe('split view entry', () => {
  it('hides split view while the alpha lab is disabled', () => {
    const items = buildTabContextMenuItems({
      id: 'tab-1',
      inSplitView: false,
      index: 0,
      onClose: vi.fn(),
      onCloseLeft: vi.fn(),
      onCloseOthers: vi.fn(),
      onCloseRight: vi.fn(),
      onCloseSplitView: vi.fn(),
      onOpenInSplitView: vi.fn(),
      onTogglePin: vi.fn(),
      pinned: false,
      pinnedCount: 0,
      splitViewEnabled: false,
      t: (key) => key,
      totalCount: 2,
    });

    expect(items.some((item) => item && 'key' in item && item.key === 'openInSplitView')).toBe(
      false,
    );
  });

  it('offers opening a tab in split view', () => {
    const items = build(0, 2);
    const entry = items.find((item) => !!item && 'key' in item && item.key === 'openInSplitView');

    expect(entry && 'label' in entry ? entry.label : undefined).toBe('tab.openInSplitView');
  });

  it('offers closing split view for a tab already shown in a pane', () => {
    const items = buildTabContextMenuItems({
      id: 'tab-1',
      inSplitView: true,
      index: 0,
      onClose: vi.fn(),
      onCloseLeft: vi.fn(),
      onCloseOthers: vi.fn(),
      onCloseRight: vi.fn(),
      onCloseSplitView: vi.fn(),
      onOpenInSplitView: vi.fn(),
      onTogglePin: vi.fn(),
      pinned: false,
      pinnedCount: 0,
      splitViewEnabled: true,
      t: (key) => key,
      totalCount: 2,
    });
    const entry = items.find((item) => !!item && 'key' in item && item.key === 'closeSplitView');

    expect(entry && 'label' in entry ? entry.label : undefined).toBe('tab.closeSplitView');
  });
});

describe('bulk close entries reflect what pinning spares', () => {
  it('disables closing others when every other tab is pinned', () => {
    expect(isDisabled(build(2, 3, false, 2), 'closeOtherTabs')).toBe(true);
  });

  it('keeps closing others available while an unpinned neighbour remains', () => {
    expect(isDisabled(build(2, 4, false, 2), 'closeOtherTabs')).toBe(false);
  });

  it('disables closing left when only pinned tabs lie to the left', () => {
    expect(isDisabled(build(1, 3, false, 1), 'closeLeftTabs')).toBe(true);
  });

  it('keeps closing left available once an unpinned tab lies to the left', () => {
    expect(isDisabled(build(2, 3, false, 1), 'closeLeftTabs')).toBe(false);
  });

  it('disables closing right when only pinned tabs lie to the right', () => {
    expect(isDisabled(build(0, 2, true, 2), 'closeRightTabs')).toBe(true);
  });

  it('keeps closing right available for a pinned tab with unpinned tabs after the run', () => {
    expect(isDisabled(build(0, 3, true, 2), 'closeRightTabs')).toBe(false);
  });
});
