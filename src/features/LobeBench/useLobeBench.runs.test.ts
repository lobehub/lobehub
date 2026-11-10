import type { AgentEvalRunListItem } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentEvalService } from '@/services/agentEval';
import { fetchLobeBenchRuns } from '@/store/eval/slices/lobeBench/fetchers';

import { useExperimentActions } from './useExperimentActions';

/** What the experiment run list's replica fetches. */
const loadExperimentRuns = () => agentEvalService.listAllRuns({ experimentId: 'experiment-a' });

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agentEval: { abortRun: { mutate: mocks.abort }, listRuns: { query: mocks.list } },
  },
}));
vi.mock('@/store/eval', () => ({ useEvalStore: vi.fn() }));
vi.mock('@lobehub/ui', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const runs = (count: number, prefix = 'run') =>
  Array.from({ length: count }, (_, index) => ({
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, count - index)).toISOString(),
    id: `${prefix}-${index}`,
    name: `${prefix} ${index}`,
    status: index % 2 ? 'pending' : 'running',
  })) as AgentEvalRunListItem[];

const pageResponse = (items: AgentEvalRunListItem[], limit = 50, offset = 0) => {
  const data = items.slice(offset, offset + limit);
  // The current API reports page length, not the total number of matching runs.
  return { data, total: data.length };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.abort.mockResolvedValue({ success: true });
});

describe('complete LobeBench run lists', () => {
  it.each([55, 205])('loads and stops every active run in a %i-run experiment', async (count) => {
    const all = runs(count);
    mocks.list.mockImplementation(({ limit, offset }) =>
      Promise.resolve(pageResponse(all, limit, offset)),
    );
    const loaded = await loadExperimentRuns();
    expect(loaded.map(({ id }) => id)).toEqual(all.map(({ id }) => id));
    expect(mocks.list.mock.calls.every(([params]) => params.experimentId === 'experiment-a')).toBe(
      true,
    );

    const { result } = renderHook(() =>
      useExperimentActions({
        experimentId: 'experiment-a',
        onRerunStarted: vi.fn(),
        refreshResults: vi.fn().mockResolvedValue(undefined),
        refreshRuns: vi.fn().mockResolvedValue(undefined),
        targets: loaded.map((run) => ({
          name: run.name!,
          runId: run.id,
          status: run.status,
          unverified: 0,
        })),
      }),
    );
    await act(() => result.current.stop());
    expect(mocks.abort.mock.calls.map(([params]) => params.id)).toEqual(all.map(({ id }) => id));
  });

  it('loads every benchmark page before combining and sorting history', async () => {
    const first = runs(210, 'first');
    const second = runs(55, 'second');
    mocks.list.mockImplementation(({ benchmarkId, limit, offset }) =>
      Promise.resolve(pageResponse(benchmarkId === 'first' ? first : second, limit, offset)),
    );
    const loaded = await fetchLobeBenchRuns(['first', 'second']);
    expect(loaded).toHaveLength(265);
    expect(new Set(loaded.map(({ id }) => id))).toEqual(
      new Set([...first, ...second].map(({ id }) => id)),
    );
    expect(loaded.map(({ createdAt }) => new Date(createdAt).getTime())).toEqual(
      loaded.map(({ createdAt }) => new Date(createdAt).getTime()).sort((a, b) => b - a),
    );
  });

  it('terminates on an empty page when the total is a multiple of the page size', async () => {
    const all = runs(100);
    mocks.list.mockImplementation(({ limit, offset }) =>
      Promise.resolve(pageResponse(all, limit, offset)),
    );
    expect(await loadExperimentRuns()).toHaveLength(100);
    expect(mocks.list.mock.calls.at(-1)?.[0].offset).toBe(100);
  });

  it('rejects a later page failure instead of returning an incomplete success', async () => {
    const failure = new Error('Next page unavailable');
    mocks.list.mockImplementation(({ limit, offset = 0 }) =>
      offset > 0
        ? Promise.reject(failure)
        : Promise.resolve(pageResponse(runs(205), limit, offset)),
    );
    await expect(loadExperimentRuns()).rejects.toBe(failure);
  });

  it('deduplicates overlapping pages when concurrent creation shifts the offset', async () => {
    const all = runs(125);
    mocks.list.mockImplementation(({ offset = 0 }) =>
      Promise.resolve({ data: offset === 0 ? all.slice(0, 100) : all.slice(99), total: 100 }),
    );
    const loaded = await loadExperimentRuns();
    expect(loaded.map(({ id }) => id)).toEqual(all.map(({ id }) => id));
  });
});
