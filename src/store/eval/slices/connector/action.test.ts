// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    getDatasetConnectorBindings: vi.fn(),
    getEvalConnector: vi.fn(),
    listEvalConnectors: vi.fn(),
  },
}));

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map(), shouldRetryOnError: false } },
    children,
  );

const connection = (id: string) => ({ id, name: id }) as never;

beforeEach(() => {
  vi.spyOn(cacheScope, 'get').mockReturnValue('eval-user:personal');
  vi.spyOn(cacheScope, 'use').mockReturnValue('eval-user:personal');
  useEvalStore.setState({
    datasetConnectorBindingsMap: {},
    evalConnectorDetailMap: {},
    evalConnectorListMap: {},
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Dataset connection replicas', () => {
  it('does not fetch a global inventory before a Dataset exists', async () => {
    const { result } = renderHook(() => useEvalStore.getState().useFetchEvalConnectors(), {
      wrapper,
    });
    await Promise.resolve();
    expect(agentEvalService.listEvalConnectors).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('keeps each Dataset’s connections in its own entry', async () => {
    vi.mocked(agentEvalService.listEvalConnectors).mockImplementation(
      async (datasetId) => [connection(`${datasetId}-connection`)] as never,
    );
    const { result } = renderHook(
      () => ({
        a: useEvalStore.getState().useFetchEvalConnectors('a'),
        b: useEvalStore.getState().useFetchEvalConnectors('b'),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.b.data).toBeDefined());
    await waitFor(() => expect(result.current.a.data).toBeDefined());
    expect(agentEvalService.listEvalConnectors).toHaveBeenCalledWith('a');
    expect(agentEvalService.listEvalConnectors).toHaveBeenCalledWith('b');
    expect(useEvalStore.getState().evalConnectorListMap).toEqual({
      a: [connection('a-connection')],
      b: [connection('b-connection')],
    });
  });

  it('reads one connection within its Dataset', async () => {
    vi.mocked(agentEvalService.getEvalConnector).mockResolvedValue(connection('c1'));
    const { result } = renderHook(() => useEvalStore.getState().useFetchEvalConnector('a', 'c1'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual(connection('c1')));
    expect(agentEvalService.getEvalConnector).toHaveBeenCalledWith('a', 'c1');
  });

  it('exposes a failed first load instead of a loading state', async () => {
    const failure = new Error('Service unavailable');
    vi.mocked(agentEvalService.getDatasetConnectorBindings).mockRejectedValue(failure);
    const { result } = renderHook(
      () => useEvalStore.getState().useFetchDatasetConnectorBindings('a'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});
