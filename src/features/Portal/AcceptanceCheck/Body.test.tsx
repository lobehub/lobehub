import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Body from './Body';

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Empty: () => <div />,
  Flexbox: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className} data-testid={'detail-surface'}>
      {children}
    </div>
  ),
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: vi.fn() } }) },
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
  CheckRow: ({ variant }: { variant: string }) => (
    <div data-testid={'check-row'} data-variant={variant} />
  ),
  useAcceptanceBundle: () => ({
    data: {
      acceptance: { id: 'acc-1' },
      checks: [{ id: 'check-1' }],
      isOwner: true,
    },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

describe('AcceptanceCheck Portal Body', () => {
  it('renders the expanded check directly on a borderless detail surface', () => {
    render(<Body />);

    const surface = screen.getByTestId('detail-surface');
    const checkRow = screen.getByTestId('check-row');

    expect(checkRow).toHaveAttribute('data-variant', 'panel');
    expect(checkRow.parentElement).toBe(surface);
    expect(surface.querySelector('[class*="block"]')).toBeNull();
  });
});
