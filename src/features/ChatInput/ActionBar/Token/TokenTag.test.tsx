/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Token from './TokenTag';

const state = vi.hoisted(() => ({ isMobile: false }));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => state.isMobile,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    config: () => ({ isDevMode: true }),
  },
}));

vi.mock('@lobehub/ui/chat', () => ({
  TokenTag: () => <span data-testid="token-tag" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./useTokenBreakdown', () => ({
  useTokenBreakdown: () => ({
    chatsToken: 10,
    historySummaryToken: 0,
    maxTokens: 100,
    systemRoleToken: 0,
    toolsToken: 0,
    totalToken: 10,
  }),
}));

vi.mock('../components/ActionPopover', () => ({
  default: ({ children, trigger }: { children: ReactNode; trigger?: string }) => (
    <div data-testid="action-popover" data-trigger={trigger}>
      {children}
    </div>
  ),
}));

describe('TokenTag', () => {
  beforeEach(() => {
    state.isMobile = false;
  });

  it('uses a click trigger on mobile', () => {
    state.isMobile = true;

    render(<Token />);

    expect(screen.getByTestId('action-popover').dataset.trigger).toBe('click');
  });

  it('keeps hover on desktop', () => {
    render(<Token />);

    expect(screen.getByTestId('action-popover').dataset.trigger).toBe('hover');
  });
});
