import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TokenDetail from './index';

let mockIsMobile = false;
let mockIsShortFormat = true;
let mockIsShowCredit = false;
let mockModelCard: any = {
  displayName: 'GPT-4o',
  id: 'gpt-4o',
  pricing: {
    units: [
      { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
    ],
  },
};
const mockUpdateSystemStatus = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mockIsMobile,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: any) => unknown) =>
    selector({
      status: {
        isShowCredit: mockIsShowCredit,
        tokenDisplayFormatShort: mockIsShortFormat,
      },
      updateSystemStatus: mockUpdateSystemStatus,
    }),
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    getModelCard: () => () => mockModelCard,
  },
  useAiInfraStore: (selector: (s: any) => unknown) => selector({}),
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children, horizontal: _h, gap: _g, ...rest }: any) => <div {...rest}>{children}</div>,
  Divider: () => <hr />,
  Flexbox: ({ children, horizontal: _h, gap: _g, align: _a, justify: _j, ...rest }: any) => (
    <div {...rest}>{children}</div>
  ),
  Icon: () => <span />,
  Popover: ({ children, content, trigger }: any) => (
    <div data-testid="usage-popover" data-trigger={trigger}>
      <div data-testid="usage-popover-trigger">{children}</div>
      <div data-testid="usage-popover-content">{content}</div>
    </div>
  ),
  cssVar: {
    borderRadiusSM: '4px',
    colorFill: '#ccc',
    colorFillTertiary: '#eee',
    colorSuccess: '#0f0',
    colorText: '#111',
    colorTextDescription: '#666',
    colorTextSecondary: '#999',
    cyan9: '#0ff',
    geekblue: '#00f',
    green: '#0a0',
    orange: '#fa0',
    pink: '#f0a',
    purple: '#a0f',
    yellow: '#ff0',
  },
}));

vi.mock('./AnimatedNumber', () => ({
  default: ({ value, formatter }: { formatter?: (v: number) => string; value: number }) => (
    <span data-testid="animated-number">{formatter ? formatter(value) : value}</span>
  ),
}));

vi.mock('./ModelCard', () => ({
  default: () => <div data-testid="model-card" />,
}));

vi.mock('./TokenProgress', () => ({
  default: () => <div data-testid="token-progress" />,
}));

const sampleUsage = {
  inputTextTokens: 8000,
  outputTextTokens: 4500,
  totalInputTokens: 8000,
  totalOutputTokens: 4500,
  totalTokens: 12500,
};

describe('TokenDetail (UsageDetail)', () => {
  beforeEach(() => {
    mockIsMobile = false;
    mockIsShortFormat = true;
    mockIsShowCredit = false;
    mockModelCard = {
      displayName: 'GPT-4o',
      id: 'gpt-4o',
      pricing: {
        units: [
          { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
    };
    mockUpdateSystemStatus.mockClear();
  });

  it('uses click trigger on mobile without conflicting trigger click toggle, and toggles format inside popover', () => {
    mockIsMobile = true;
    mockIsShortFormat = true;

    render(<TokenDetail model="gpt-4o" provider="openai" usage={sampleUsage} />);

    expect(screen.getByTestId('usage-popover').getAttribute('data-trigger')).toBe('click');
    expect(screen.getByTestId('animated-number').textContent).toBe('12.5k');

    // Tapping the token badge on mobile must NOT toggle format directly (it opens the popover instead)
    fireEvent.click(screen.getByTestId('animated-number'));
    expect(mockUpdateSystemStatus).not.toHaveBeenCalled();

    // Tapping the in-popover format toggle switches compact -> full and meets >=44px mobile touch target
    const toggleBtn = screen.getByTestId('token-format-toggle');
    expect(toggleBtn.textContent).toContain('messages.tokenDetails.format.compact');
    expect(toggleBtn.style.minHeight).toBe('44px');
    expect(toggleBtn.style.minWidth).toBe('44px');
    fireEvent.click(toggleBtn);
    expect(mockUpdateSystemStatus).toHaveBeenCalledWith({ tokenDisplayFormatShort: false });
  });

  it('uses hover trigger on desktop and preserves direct trigger click toggle as well as in-popover toggle', () => {
    mockIsMobile = false;
    mockIsShortFormat = false;

    render(<TokenDetail model="gpt-4o" provider="openai" usage={sampleUsage} />);

    expect(screen.getByTestId('usage-popover').getAttribute('data-trigger')).toBe('hover');
    expect(screen.getByTestId('animated-number').textContent).toBe('12,500');

    // Desktop quick-toggle on badge still works
    fireEvent.click(screen.getByTestId('animated-number'));
    expect(mockUpdateSystemStatus).toHaveBeenCalledWith({ tokenDisplayFormatShort: true });

    // In-popover toggle also works on desktop
    mockUpdateSystemStatus.mockClear();
    const toggleBtn = screen.getByTestId('token-format-toggle');
    expect(toggleBtn.textContent).toContain('messages.tokenDetails.format.full');
    fireEvent.click(toggleBtn);
    expect(mockUpdateSystemStatus).toHaveBeenCalledWith({ tokenDisplayFormatShort: true });
  });

  it('hides the token number format toggle when showing credit/USD mode', () => {
    mockIsMobile = true;
    mockIsShowCredit = true;

    render(<TokenDetail model="gpt-4o" provider="openai" usage={sampleUsage} />);

    expect(screen.queryByTestId('token-format-toggle')).toBeNull();
  });
});
