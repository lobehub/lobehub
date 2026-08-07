import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEventHandler, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InterestsRow from './InterestsRow';

const mocks = vi.hoisted(() => ({
  interests: [] as string[],
  saveToast: vi.fn(),
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
        return (
          (
            {
              'profile.interests': 'Interests',
              'profile.saveError': 'Could not save interests',
            } as Record<string, string>
          )[key] ?? key
        );
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

vi.mock('@/store/utils/saveToast', () => ({
  saveToast: mocks.saveToast,
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
  mocks.saveToast.mockReset();
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

  it('reports a failed save through the shared save toast without touching the row layout', async () => {
    const user = userEvent.setup();
    const failure = new Error('network detail');
    mocks.updateInterests.mockRejectedValueOnce(failure);

    render(<InterestsRow />);

    await user.click(screen.getByRole('button', { name: '编程与开发' }));

    await waitFor(() => {
      expect(mocks.saveToast).toHaveBeenCalledWith(failure, {
        retry: expect.any(Function),
        title: 'Could not save interests',
      });
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries the same payload from the toast action', async () => {
    const user = userEvent.setup();
    mocks.updateInterests.mockRejectedValueOnce(new Error('network detail'));

    render(<InterestsRow />);

    await user.click(screen.getByRole('button', { name: '编程与开发' }));

    await waitFor(() => expect(mocks.saveToast).toHaveBeenCalled());

    await mocks.saveToast.mock.calls[0][1].retry();

    expect(mocks.updateInterests).toHaveBeenNthCalledWith(2, ['coding']);
  });
});
