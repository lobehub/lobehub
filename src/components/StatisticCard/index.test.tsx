import { render, screen } from '@testing-library/react';
import { type ComponentProps, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import StatisticCard from './index';

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Block: ({
      children,
      className,
      padding,
      paddingBlock,
      paddingInline,
      style,
      variant,
    }: {
      children?: ReactNode;
      className?: string;
      padding?: number | string;
      paddingBlock?: number | string;
      paddingInline?: number | string;
      style?: ComponentProps<'div'>['style'];
      variant?: string;
    }) => (
      <div
        className={className}
        data-padding={padding}
        data-padding-block={paddingBlock}
        data-padding-inline={paddingInline}
        data-testid="block"
        data-variant={variant}
        style={style}
      >
        {children}
      </div>
    ),
  };
});

describe('StatisticCard', () => {
  it('renders title and formatted value with prefix, suffix and precision', () => {
    render(
      <StatisticCard
        statistic={{ precision: 2, prefix: '$', suffix: 'k', value: 1234.5 }}
        title="Total Cost"
      />,
    );

    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('.50')).toBeInTheDocument();
    expect(screen.getByText('k')).toBeInTheDocument();
  });

  it('renders a custom node title as-is', () => {
    render(
      <StatisticCard statistic={{ value: 1 }} title={<span data-testid="custom-title">Hi</span>} />,
    );

    expect(screen.getByTestId('custom-title')).toHaveTextContent('Hi');
  });

  it('renders description below the value and extra in the header', () => {
    render(
      <StatisticCard
        extra={<button type="button">More</button>}
        statistic={{ description: <span>desc line</span>, value: 10 }}
        title="Tokens"
      />,
    );

    expect(screen.getByText('desc line')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('replaces extra with a small spinner while loading', () => {
    const { container } = render(
      <StatisticCard
        loading
        extra={<button type="button">More</button>}
        statistic={{ value: 10 }}
        title="Tokens"
      />,
    );

    expect(screen.queryByText('More')).toBeNull();
    expect(container.querySelector('.ant-spin')).not.toBeNull();
  });

  it('applies valueStyle to the statistic content', () => {
    const { container } = render(
      <StatisticCard
        statistic={{ value: 10, valueStyle: { color: 'rgb(255, 0, 0)' } }}
        title="Savings"
      />,
    );

    expect(container.querySelector('.ant-statistic-content')).toHaveStyle({
      color: 'rgb(255, 0, 0)',
    });
  });

  it('passes variant and padding props through to Block', () => {
    render(
      <StatisticCard
        padding={24}
        paddingBlock={8}
        paddingInline={16}
        title="T"
        variant="outlined"
      />,
    );

    const block = screen.getByTestId('block');
    expect(block).toHaveAttribute('data-variant', 'outlined');
    expect(block).toHaveAttribute('data-padding', '24');
    expect(block).toHaveAttribute('data-padding-block', '8');
    expect(block).toHaveAttribute('data-padding-inline', '16');
  });

  it('defaults to the borderless variant', () => {
    render(<StatisticCard title="T" />);

    expect(screen.getByTestId('block')).toHaveAttribute('data-variant', 'borderless');
  });
});
