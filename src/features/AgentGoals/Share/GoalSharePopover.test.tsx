/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GoalSharePopover from './GoalSharePopover';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  copyToClipboard: vi.fn(),
  disableGoalShare: vi.fn(),
  enableGoalShare: vi.fn(),
  fetchResult: { error: undefined as unknown, isLoading: false, mutate: vi.fn() },
  setGoalShareVisibility: vi.fn(),
  share: undefined as unknown,
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://lobe.test' }));
vi.mock('@/components/Skeleton', () => ({ ArticleSkeleton: () => <div data-testid="skeleton" /> }));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: mocks.confirmModal,
  copyToClipboard: mocks.copyToClipboard,
  toast: mocks.toast,
}));

vi.mock('@/store/goal', () => {
  const state = () => ({
    disableGoalShare: mocks.disableGoalShare,
    enableGoalShare: mocks.enableGoalShare,
    goalShareById: { goal_1: mocks.share },
    setGoalShareVisibility: mocks.setGoalShareVisibility,
    useFetchGoalShare: () => mocks.fetchResult,
  });
  return {
    goalSelectors: { goalShare: () => () => mocks.share },
    useGoalStore: Object.assign((selector: (s: any) => unknown) => selector(state()), {
      getState: state,
    }),
  };
});

const shared = (visibility: 'link' | 'private') => ({
  goalId: 'goal_1',
  id: 'abc123',
  pageViewCount: 0,
  userId: 'user_1',
  visibility,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.share = null;
  mocks.fetchResult = { error: undefined, isLoading: false, mutate: vi.fn() };
  mocks.enableGoalShare.mockImplementation(async () => {
    mocks.share = shared('link');
  });
});

describe('GoalSharePopover', () => {
  it('starts unshared: switch off, no link, no stop action', () => {
    render(<GoalSharePopover goalId="goal_1" />);

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByDisplayValue(/share\/goal/)).toBeNull();
    expect(screen.queryByText('goalDetail.share.stop')).toBeNull();
  });

  it('enables link sharing and copies the link', async () => {
    render(<GoalSharePopover goalId="goal_1" />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(mocks.enableGoalShare).toHaveBeenCalledWith('goal_1', 'link'));
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith('https://lobe.test/share/goal/abc123'),
    );
  });

  it('shows the copyable link of a link share and switches it back to private', async () => {
    mocks.share = shared('link');
    mocks.setGoalShareVisibility.mockResolvedValue(undefined);
    render(<GoalSharePopover goalId="goal_1" />);

    expect(screen.getByDisplayValue('https://lobe.test/share/goal/abc123')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(mocks.setGoalShareVisibility).toHaveBeenCalledWith('goal_1', 'private'),
    );
  });

  it('hides the link while the share is private but keeps Stop sharing', () => {
    mocks.share = shared('private');
    render(<GoalSharePopover goalId="goal_1" />);

    expect(screen.queryByDisplayValue(/share\/goal/)).toBeNull();
    expect(screen.getByText('goalDetail.share.stop')).toBeTruthy();
  });

  it('asks before stopping, then removes the share', async () => {
    mocks.share = shared('link');
    mocks.disableGoalShare.mockResolvedValue(undefined);
    render(<GoalSharePopover goalId="goal_1" />);

    fireEvent.click(screen.getByText('goalDetail.share.stop'));
    expect(mocks.disableGoalShare).not.toHaveBeenCalled();

    await mocks.confirmModal.mock.calls[0][0].onOk();
    expect(mocks.disableGoalShare).toHaveBeenCalledWith('goal_1');
  });

  it('reports a failed update instead of staying silent', async () => {
    mocks.enableGoalShare.mockRejectedValue(new Error('boom'));
    render(<GoalSharePopover goalId="goal_1" />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('goalDetail.share.updateError'),
    );
  });

  it('shows a retry, not the unshared state, when the first read fails', () => {
    mocks.share = undefined;
    mocks.fetchResult = { error: new Error('x'), isLoading: false, mutate: vi.fn() };
    render(<GoalSharePopover goalId="goal_1" />);

    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByText('retry'));
    expect(mocks.fetchResult.mutate).toHaveBeenCalled();
  });
});
