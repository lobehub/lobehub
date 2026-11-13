/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Arguments from './index';

const accountNames: Record<string, string> = { lnk_work: 'work@acme.com' };

vi.mock('@/store/tool', () => ({
  useToolStore: <T,>(selector: (state: object) => T) => selector({}),
}));

vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: {
    connectorLinkNameById: (linkId: string) => () => accountNames[linkId],
  },
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ActionIcon: ({
    active,
    onClick,
    title,
  }: {
    active?: boolean;
    onClick?: () => void;
    title?: string;
  }) => (
    <button aria-pressed={active} type="button" onClick={onClick}>
      {title}
    </button>
  ),
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

  it('names the connector account a call uses instead of its link id', () => {
    render(
      <Arguments
        arguments={JSON.stringify({ link_id: 'lnk_work', subject: 'Hello', to: 'lnk_work' })}
      />,
    );

    const values = screen.getByTestId('descriptions');
    expect(values).toHaveTextContent('work@acme.com');
    expect(values).toHaveTextContent('Hello');
    // Only the account argument is translated; a lookalike value elsewhere is data.
    expect(values).toHaveTextContent('lnk_work');
  });

  it('uses the renamed argument when the tool has its own link_id', () => {
    render(
      <Arguments
        arguments={JSON.stringify({ connector_link_id: 'lnk_work', link_id: 'https://a.b/c' })}
      />,
    );

    expect(screen.getByTestId('descriptions')).toHaveTextContent('work@acme.comhttps://a.b/c');
  });

  it('shows an id that names no known account as it was sent', () => {
    render(<Arguments arguments={JSON.stringify({ link_id: 'lnk_gone' })} />);

    expect(screen.getByTestId('descriptions')).toHaveTextContent('lnk_gone');
  });
});
