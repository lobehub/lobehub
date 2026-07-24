import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Body from './Body';

const mocks = vi.hoisted(() => ({
  bundleError: undefined as Error | undefined,
  mutate: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Empty: () => <div />,
  Flexbox: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className} data-testid={className ? 'detail-surface' : undefined}>
      {children}
    </div>
  ),
  Icon: () => <span data-testid={'check-state-icon'} />,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: vi.fn() } }) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      openAcceptance: vi.fn(),
      portalData: { acceptanceId: 'acc-1', checkId: 'check-1', type: 'acceptanceCheck' },
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    acceptanceCheckPortal: (state: { portalData: { acceptanceId: string; checkId: string } }) =>
      state.portalData,
  },
}));

vi.mock('@/features/Verify', () => ({
  checkHeadMeta: () => ({ color: 'green', icon: () => null }),
  FocusedCheckDetails: () => <div data-testid={'check-details'} />,
  useAcceptanceBundle: () => ({
    data: {
      acceptance: { id: 'acc-1' },
      checks: [{ id: 'check-1', seq: 3, title: 'The result keeps its title' }],
      isOwner: true,
    },
    error: mocks.bundleError,
    isLoading: false,
    mutate: mocks.mutate,
  }),
}));

describe('AcceptanceCheck Portal Body', () => {
  beforeEach(() => {
    mocks.bundleError = undefined;
    mocks.mutate.mockReset();
  });

  it('renders the expanded check directly on a borderless detail surface', () => {
    render(<Body />);

    const surface = screen.getByTestId('detail-surface');
    const checkDetails = screen.getByTestId('check-details');

    expect(checkDetails.parentElement).toBe(surface);
    expect(surface.querySelector('[class*="block"]')).toBeNull();
  });

  it('keeps the selected check identity visible above its details', () => {
    render(<Body />);

    expect(screen.getByText('C3 · The result keeps its title')).toBeInTheDocument();
    expect(screen.getByTestId('check-state-icon')).toBeInTheDocument();
  });

  it('offers an in-place retry when loading the selected check fails', () => {
    mocks.bundleError = new Error('network failed');

    render(<Body />);

    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.acceptance.retry' }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
});
