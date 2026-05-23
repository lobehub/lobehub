/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Arguments from './index';

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    active,
    icon: IconComponent,
    onClick,
    title,
  }: {
    active?: boolean;
    icon?: ComponentType;
    onClick?: () => void;
    title?: string;
  }) => (
    <button aria-pressed={active} type="button" onClick={onClick}>
      {title}
      {IconComponent ? <IconComponent /> : null}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children, wrap }: { children?: ReactNode; wrap?: boolean }) => (
    <pre data-testid="highlighter" data-wrap={String(Boolean(wrap))}>
      {children}
    </pre>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  Divider: () => <hr />,
}));

vi.mock('@/components/Descriptions', () => ({
  default: ({
    items,
    wrap,
  }: {
    items: Array<{ key: string; value: ReactNode }>;
    wrap?: boolean;
  }) => (
    <div data-testid="descriptions" data-wrap={String(Boolean(wrap))}>
      {items.map((item) => (
        <span key={item.key}>{item.value}</span>
      ))}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) =>
      (
        ({
          'arguments.title': 'Arguments',
          'workingPanel.review.wordWrap.disable': 'Disable word wrap',
          'workingPanel.review.wordWrap.enable': 'Enable word wrap',
        }) as Record<string, string>
      )[options?.ns === 'chat' ? key : key] || key,
  }),
}));

describe('Arguments', () => {
  it('keeps argument values collapsed by default and toggles wrapping', () => {
    render(<Arguments arguments={JSON.stringify({ file_path: '/very/long/path/to/file.ts' })} />);

    expect(screen.getByTestId('descriptions')).toHaveAttribute('data-wrap', 'false');

    fireEvent.click(screen.getByRole('button', { name: /enable word wrap/i }));

    expect(screen.getByTestId('descriptions')).toHaveAttribute('data-wrap', 'true');
    expect(screen.getByRole('button', { name: /disable word wrap/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
