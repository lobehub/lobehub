import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEventHandler, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InterestsRow from './InterestsRow';

const mocks = vi.hoisted(() => ({
  interests: [] as string[],
  updateInterests: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Input: () => null,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: (namespace: string) => ({
    t: (key: string) => {
      if (namespace === 'auth') {
        return ({ 'profile.interests': 'Interests' } as Record<string, string>)[key] ?? key;
      }

      return (
        (
          {
            'interests.area.coding': '编程与开发',
            'interests.area.other': '其他领域',
            'interests.area.writing': '内容创作',
          } as Record<string, string>
        )[key] ?? key
      );
    },
  }),
}));

vi.mock('@/components/Error/fetchErrorNotification', () => ({
  fetchErrorNotification: {
    error: vi.fn(),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateInterests: mocks.updateInterests,
      user: { interests: mocks.interests },
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    interests: (state: { user?: { interests?: string[] } }) => state.user?.interests ?? [],
  },
}));

vi.mock('./ProfileRow', () => ({
  default: ({ children, label }: { children: ReactNode; label: string }) => (
    <section aria-label={label}>{children}</section>
  ),
}));

beforeEach(() => {
  mocks.interests = [];
  mocks.updateInterests.mockReset();
  mocks.updateInterests.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('InterestsRow', () => {
  it('stores predefined interests as canonical keys', async () => {
    const user = userEvent.setup();

    render(<InterestsRow />);

    await user.click(screen.getByRole('button', { name: '编程与开发' }));

    await waitFor(() => {
      expect(mocks.updateInterests).toHaveBeenCalledWith(['coding']);
    });
  });

  it('removes predefined interests by canonical key', async () => {
    const user = userEvent.setup();
    mocks.interests = ['coding', '自定义'];

    render(<InterestsRow />);

    await user.click(screen.getByRole('button', { name: '编程与开发' }));

    await waitFor(() => {
      expect(mocks.updateInterests).toHaveBeenCalledWith(['自定义']);
    });
  });
});
