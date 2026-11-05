/**
 * @vitest-environment happy-dom
 */
import type { LinearIssuePage, LinearIssueSummary } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import IssueList from './IssueList';

const mocks = vi.hoisted(() => ({
  countIssues: vi.fn(),
  listIssues: vi.fn(),
}));

vi.mock('@/services/linear', () => ({
  linearService: { countIssues: mocks.countIssues, listIssues: mocks.listIssues },
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

const filter = { connectionId: 'connection-1', stateTypes: ['unstarted' as const], teamId: 'team' };

const issue = (index: number): LinearIssueSummary => ({
  id: `issue-${index}`,
  identifier: `LOBE-${index}`,
  priority: 0,
  stateName: 'Todo',
  stateType: 'unstarted',
  title: `Issue ${index}`,
  updatedAt: '2026-11-04T00:00:00.000Z',
  url: `https://linear.app/lobehub/issue/LOBE-${index}`,
});

const page = (count: number, hasMore: boolean): LinearIssuePage => ({
  cursor: hasMore ? 'cursor-1' : undefined,
  hasMore,
  issues: Array.from({ length: count }, (_, index) => issue(index)),
});

const renderList = () =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <IssueList filter={filter} selected={new Set()} onSelectionChange={vi.fn()} />
    </SWRConfig>,
  );

beforeEach(() => {
  mocks.countIssues.mockReset();
  mocks.listIssues.mockReset();
});

describe('IssueList header', () => {
  it('shows the total of the filter, not the 50 loaded, while more pages remain', async () => {
    mocks.listIssues.mockResolvedValue(page(50, true));
    mocks.countIssues.mockResolvedValue({ capped: false, count: 234 });

    renderList();

    expect(await screen.findByText('linear.sync.list.count:234')).toBeTruthy();
    expect(screen.getByText('linear.sync.list.loaded:50')).toBeTruthy();
    expect(mocks.countIssues).toHaveBeenCalledWith(filter);
  });

  it('reads as "at least" until the count arrives', async () => {
    mocks.listIssues.mockResolvedValue(page(50, true));
    mocks.countIssues.mockReturnValue(new Promise(() => {}));

    renderList();

    expect(await screen.findByText('linear.sync.list.countAtLeast:50')).toBeTruthy();
  });

  it('does not count again when the first page holds every issue', async () => {
    mocks.listIssues.mockResolvedValue(page(12, false));

    renderList();

    expect(await screen.findByText('linear.sync.list.count:12')).toBeTruthy();
    expect(screen.queryByText(/linear\.sync\.list\.loaded/)).toBeNull();
    expect(mocks.countIssues).not.toHaveBeenCalled();
  });
});
