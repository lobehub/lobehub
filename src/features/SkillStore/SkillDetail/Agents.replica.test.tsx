/**
 * @vitest-environment happy-dom
 *
 * "Agents using this skill" reads one replica entry per page, persisted to
 * IndexedDB: reopening a detail paints the last confirmed first page before
 * the network answers. A hydrated empty page is not proof of "no agents" until
 * the server confirms it, and a failed refresh keeps the agents on screen.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import {
  deferred,
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';

import Agents from './Agents';

vi.mock('@/store/global/helpers', () => ({
  globalHelpers: { getCurrentLanguage: () => 'en-US' },
}));
vi.mock('./DetailContext', () => ({ useDetailContext: () => ({ identifier: 'web-search' }) }));
vi.mock('./AgentItem', () => ({
  default: ({ title }: { title?: string }) => <div data-testid="agent">{title}</div>,
}));
vi.mock('react-virtuoso', () => ({
  VirtuosoGrid: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => unknown;
  }) => <div>{data.map((item, index) => itemContent(index, item) as never)}</div>,
}));

const page = (titles: string[], totalCount = titles.length) => ({
  currentPage: 1,
  items: titles.map((title) => ({ identifier: title, title })),
  pageSize: 12,
  totalCount,
  totalPages: 1,
});

// Entry key of the first page: plugin, page, page size and the UI language.
const FIRST_PAGE = stableQueryKey({
  locale: 'en-US',
  page: 1,
  pageSize: 12,
  pluginId: 'web-search',
});

describe('SkillDetail Agents', () => {
  const { persist } = useReplicaHarness('plugin-agents');

  it('paints the persisted first page before the network answers, then refreshes it', async () => {
    await persist('discoverPluginAgents', FIRST_PAGE, page(['Cached agent']));
    const next = deferred<unknown>();
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(() => next.promise as never);

    render(<Agents />, { wrapper });

    expect(await screen.findByText('Cached agent')).toBeInTheDocument();

    await act(async () => next.resolve(page(['Fresh agent'])));
    expect(await screen.findByText('Fresh agent')).toBeInTheDocument();
  });

  it('keeps loading over a hydrated empty page until the server confirms it', async () => {
    await persist('discoverPluginAgents', FIRST_PAGE, page([]));
    const next = deferred<unknown>();
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(() => next.promise as never);

    const { container } = render(<Agents />, { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('skillDetail.noAgents')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="skeleton"], .ant-skeleton')).toBeTruthy();

    await act(async () => next.resolve(page([])));
    expect(await screen.findByText(/noAgents|No agents/i)).toBeInTheDocument();
  });

  it('keeps the agents on screen when a refresh fails', async () => {
    await persist('discoverPluginAgents', FIRST_PAGE, page(['Cached agent']));
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockRejectedValue(new Error('network down'));

    render(<Agents />, { wrapper });

    expect(await screen.findByText('Cached agent')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('Cached agent')).toBeInTheDocument();
  });

  it("never paints another identity's agents", async () => {
    await persist('discoverPluginAgents', FIRST_PAGE, page(['Theirs']), 'someone-else:personal');
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(pending);

    render(<Agents />, { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Theirs')).not.toBeInTheDocument();
  });
});
