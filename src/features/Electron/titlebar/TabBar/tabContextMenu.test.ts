import { describe, expect, it, vi } from 'vitest';

import { canGoNative } from '@/libs/contextMenu/canGoNative';
import { toNativeTemplate } from '@/libs/contextMenu/toNativeTemplate';

import { buildTabContextMenuItems } from './tabContextMenu';

const build = (index: number, totalCount: number) =>
  buildTabContextMenuItems({
    id: 'tab-1',
    index,
    onClose: vi.fn(),
    onCloseLeft: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseRight: vi.fn(),
    t: (key) => key,
    totalCount,
  });

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
