/**
 * @vitest-environment happy-dom
 */
import { TooltipGroup } from '@lobehub/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import spend from '@/locales/default/spend';

import zhSpend from '../../../../../../locales/zh-CN/spend.json';
import UsageTable from './UsageTable';

vi.unmock('react-i18next');

vi.mock('@/components/LobeIcons', () => ({
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
  type: index === 0 ? 'speechRecognition' : 'chat',
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ data: rows, isLoading: false, mutate: vi.fn() }),
}));

vi.mock('@/services/usage', () => ({
  usageService: { findByMonth: vi.fn() },
}));

// Keep pagination lightweight while exercising the actual type column renderer.
vi.mock('@/components/InlineTable', () => ({
  default: ({
    columns,
    dataSource,
  }: {
    columns: { dataIndex: string; render?: (value: string) => ReactNode }[];
    dataSource?: { id: string; type: string }[];
  }) => (
    <div>
      <div data-testid="rows">{dataSource?.map((row) => row.id).join(',')}</div>
      {dataSource?.map((row) => (
        <div data-testid={`type-${row.id}`} key={row.id}>
          {columns.find((column) => column.dataIndex === 'type')?.render?.(row.type)}
        </div>
      ))}
    </div>
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
  it.each([
    ['en-US', 'Voice Transcription'],
    ['zh-CN', '语音转写'],
  ])('renders the speech-recognition icon and label in %s', async (lng, label) => {
    const i18n = createInstance();
    await i18n.init({
      lng,
      resources: { 'en-US': { spend }, 'zh-CN': { spend: zhSpend } },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <TooltipGroup popupContainer={document.body}>
          <MemoryRouter>
            <UsageTable />
          </MemoryRouter>
        </TooltipGroup>
      </I18nextProvider>,
    );

    const cell = screen.getByTestId('type-row-1');
    expect(cell.querySelector('svg.lucide-mic')).toBeInTheDocument();
    expect(cell.querySelector('svg.lucide-circle-dot-dashed')).not.toBeInTheDocument();
    await userEvent.hover(cell.querySelector('svg')!);
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

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
