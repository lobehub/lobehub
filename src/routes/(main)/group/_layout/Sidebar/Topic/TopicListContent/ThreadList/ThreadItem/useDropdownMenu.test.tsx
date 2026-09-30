/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useThreadItemDropdownMenu } from './useDropdownMenu';

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  App: {
    useApp: () => ({
      modal: {
        confirm: vi.fn(),
      },
    }),
  },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    allowed: false,
    reason: '',
  }),
}));

const { openRenameModal, updateThreadTitle } = vi.hoisted(() => ({
  openRenameModal: vi.fn(),
  updateThreadTitle: vi.fn(),
}));

vi.mock('@/components/RenameModal', () => ({ openRenameModal }));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ removeThread: vi.fn(), updateThreadTitle }),
}));

const getMenuItem = (
  items: NonNullable<ReturnType<ReturnType<typeof useThreadItemDropdownMenu>>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('group useThreadItemDropdownMenu', () => {
  it('disables thread management actions for workspace viewers', () => {
    const { result } = renderHook(() =>
      useThreadItemDropdownMenu({ id: 'thread-1', title: 'Thread' }),
    );
    const items = result.current();

    expect(getMenuItem(items, 'rename')).toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'delete')).toMatchObject({ disabled: true });
  });

  it('renames through a modal, not an inline popover', async () => {
    const { result } = renderHook(() =>
      useThreadItemDropdownMenu({ id: 'thread-1', title: 'Old title' }),
    );
    const rename = getMenuItem(result.current(), 'rename') as unknown as { onClick: () => void };
    rename.onClick();

    expect(openRenameModal).toHaveBeenCalledWith(
      expect.objectContaining({ defaultValue: 'Old title' }),
    );
    await openRenameModal.mock.calls[0][0].onSave('New title');
    expect(updateThreadTitle).toHaveBeenCalledWith('thread-1', 'New title');
  });
});
