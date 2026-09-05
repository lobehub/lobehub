import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InterestsStep from './InterestsStep';

const mocks = vi.hoisted(() => ({
  interests: [] as string[],
  updateInterests: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'back': 'Back',
          'interests.area.coding': '编程与开发',
          'interests.area.other': '其他领域',
          'interests.area.writing': '内容创作',
          'interests.title': 'Title',
          'interests.title2': 'Title 2',
          'interests.title3': 'Title 3',
          'next': 'Next',
        }) as Record<string, string>
      )[key] ?? key,
  }),
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

vi.mock('../components/LobeMessage', () => ({
  default: () => <div>Lobe Message</div>,
}));

beforeEach(() => {
  mocks.interests = [];
  mocks.updateInterests.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('InterestsStep', () => {
  it('stores predefined interests as canonical keys', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();

    render(<InterestsStep onBack={vi.fn()} onNext={onNext} />);

    await user.click(screen.getByText('内容创作'));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(mocks.updateInterests).toHaveBeenCalledWith(['writing']);
    expect(onNext).toHaveBeenCalled();
  });
});
