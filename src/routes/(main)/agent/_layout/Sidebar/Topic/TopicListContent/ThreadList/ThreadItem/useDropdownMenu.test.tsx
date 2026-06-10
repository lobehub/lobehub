/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useThreadItemDropdownMenu } from './useDropdownMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('antd', () => ({
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

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ removeThread: vi.fn() }),
}));

const getMenuItem = (
  items: NonNullable<ReturnType<ReturnType<typeof useThreadItemDropdownMenu>>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('useThreadItemDropdownMenu', () => {
  it('disables thread management actions for workspace viewers', () => {
    const { result } = renderHook(() =>
      useThreadItemDropdownMenu({ id: 'thread-1', toggleEditing: vi.fn() }),
    );
    const items = result.current();

    expect(getMenuItem(items, 'rename')).toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'delete')).toMatchObject({ disabled: true });
  });
});
