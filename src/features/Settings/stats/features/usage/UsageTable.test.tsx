/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import UsageTable from './UsageTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/icons', () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span>{provider}</span>,
}));

const rows = Array.from({ length: 12 }, (_, index) => ({
  createdAt: new Date(2026, 0, index + 1).toISOString(),
  id: `row-${index + 1}`,
  model: 'gpt-5-mini',
  provider: 'openai',
  spend: index,
  totalInputTokens: index,
  totalOutputTokens: index,
  totalTokens: index * 2,
  tps: 1,
  ttft: 1,
  type: 'chat',
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ data: rows, isLoading: false, mutate: vi.fn() }),
}));

vi.mock('@/services/usage', () => ({
  usageService: { findByMonth: vi.fn() },
}));

// The rows on screen are the assertion, so the table only has to report which
// slice it was handed.
vi.mock('@/components/InlineTable', () => ({
  default: ({ dataSource }: { dataSource?: { id: string }[] }) => (
    <div data-testid="rows">{dataSource?.map((row) => row.id).join(',')}</div>
  ),
}));

// Stands in for the real footer, whose `onChange` likewise reports the page and
// the page size together on every interaction.
vi.mock('@/components/TablePagination', () => ({
  default: ({
    current,
    onChange,
    pageSize,
  }: {
    current: number;
    onChange: (page: number, size: number) => void;
    pageSize: number;
  }): ReactNode => (
    <div>
      <button type="button" onClick={() => onChange(current + 1, pageSize)}>
        next-page
      </button>
      <button type="button" onClick={() => onChange(1, 10)}>
        resize
      </button>
    </div>
  ),
}));

const renderTable = () =>
  render(
    <MemoryRouter>
      <UsageTable />
    </MemoryRouter>,
  );

describe('UsageTable', () => {
  it('moves to the next page when only the page changes', async () => {
    renderTable();
    expect(screen.getByTestId('rows')).toHaveTextContent('row-1,row-2,row-3,row-4,row-5');

    // Page and page size are written in one update. Writing them through two
    // separate query-param setters lost the page, because the second setter
    // rebuilt the URL from the params captured before the first one navigated.
    await userEvent.click(screen.getByText('next-page'));

    expect(screen.getByTestId('rows')).toHaveTextContent('row-6,row-7,row-8,row-9,row-10');
  });

  it('keeps the page the size picker asked for when the page size changes', async () => {
    renderTable();

    await userEvent.click(screen.getByText('next-page'));
    await userEvent.click(screen.getByText('resize'));

    expect(screen.getByTestId('rows')).toHaveTextContent(
      'row-1,row-2,row-3,row-4,row-5,row-6,row-7,row-8,row-9,row-10',
    );
  });
});
