/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicActionsDropdownMenu } from './useDropdownMenu';

const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('antd', () => {
  return {
    App: {
      useApp: () => ({
        modal: {
          confirm: vi.fn(),
          error: vi.fn(),
        },
      }),
    },
    Upload: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      importTopic: vi.fn(),
      removeSessionTopics: vi.fn(),
      removeUnstarredTopic: vi.fn(),
    }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      topicPageSize: 20,
      updateSystemStatus: vi.fn(),
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    topicPageSize: (s: { topicPageSize: number }) => s.topicPageSize,
  },
}));

const getMenuItem = (
  items: NonNullable<ReturnType<typeof useTopicActionsDropdownMenu>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('useTopicActionsDropdownMenu', () => {
  beforeEach(() => {
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
  });

  it('disables topic write management actions for workspace viewers', () => {
    permissionMock.create_content = false;
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() => useTopicActionsDropdownMenu());

    expect(getMenuItem(result.current!, 'import')).toMatchObject({ disabled: true });
    expect(getMenuItem(result.current!, 'deleteUnstarred')).toMatchObject({ disabled: true });
    expect(getMenuItem(result.current!, 'deleteAll')).toMatchObject({ disabled: true });
  });
});
