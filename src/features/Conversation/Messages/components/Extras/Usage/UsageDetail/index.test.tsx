/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TokenDetail from './index';

const state = vi.hoisted(() => ({ isMobile: false }));
const updateSystemStatus = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => state.isMobile,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: { updateSystemStatus: typeof updateSystemStatus }) => unknown,
  ) => selector({ updateSystemStatus }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    isShowCredit: () => false,
    tokenDisplayFormatShort: () => true,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    getModelCard: () => () => undefined,
  },
  useAiInfraStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/components/InfoTooltip', () => ({
  default: () => <span />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobechat/utils', () => ({
  formatUsageValue: (value: number) => `${value} tokens`,
  formatUsd: (value: number) => `$${value}`,
}));

vi.mock('@/utils/format', () => ({
  formatNumber: (value: number) => String(value),
  formatShortenNumber: (value: number) => String(value),
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
  }) => <div onClick={onClick}>{children}</div>,
  Divider: () => <hr />,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Popover: ({
    children,
    content,
    trigger,
  }: {
    children: ReactNode;
    content: ReactNode;
    trigger?: string;
  }) => (
    <div data-testid="popover" data-trigger={trigger}>
      {children}
      <div data-testid="popover-content">{content}</div>
    </div>
  ),
  cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }),
}));

vi.mock('./AnimatedNumber', () => ({
  default: ({ formatter, value }: { formatter?: (value: number) => string; value: number }) => (
    <span>{formatter ? formatter(value) : value}</span>
  ),
}));

vi.mock('./ModelCard', () => ({
  default: () => null,
}));

vi.mock('./TokenProgress', () => ({
  default: () => <div data-testid="token-progress" />,
}));

vi.mock('./tokens', () => ({
  getDetailsToken: () => ({
    inputText: { cost: 0.01, token: 1000 },
    outputText: { cost: 0.01, token: 1000 },
    totalOutput: { cost: 0.01, token: 1000 },
    totalTokens: { cost: 0.02, token: 2000 },
  }),
}));

const renderTokenDetail = () =>
  render(<TokenDetail model="gpt-4o" provider="openai" usage={{ totalTokens: 2000 }} />);

describe('TokenDetail', () => {
  beforeEach(() => {
    state.isMobile = false;
    updateSystemStatus.mockClear();
  });

  it('uses a click trigger on mobile without toggling the number format', () => {
    state.isMobile = true;

    renderTokenDetail();

    expect(screen.getByTestId('popover').dataset.trigger).toBe('click');

    fireEvent.click(screen.getByText('2000'));

    expect(updateSystemStatus).not.toHaveBeenCalled();
  });

  it('keeps hover on desktop and toggles the number format on click', () => {
    renderTokenDetail();

    expect(screen.getByTestId('popover').dataset.trigger).toBe('hover');

    fireEvent.click(screen.getByText('2000'));

    expect(updateSystemStatus).toHaveBeenCalledWith({ tokenDisplayFormatShort: false });
  });
});
