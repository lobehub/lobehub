import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientDataSWR } from '@/libs/swr';
import { evalKeys } from '@/libs/swr/keys';
import { agentEvalService } from '@/services/agentEval';

import { createConnectorSlice } from './action';

vi.mock('@/libs/swr', () => ({ useClientDataSWR: vi.fn() }));
vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    listEvalConnectors: vi.fn(),
    getEvalConnector: vi.fn(),
    getDatasetConnectorBindings: vi.fn(),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('Dataset connection cache boundaries', () => {
  it('does not fetch a global inventory before a Dataset exists', () => {
    createConnectorSlice().useFetchEvalConnectors();
    expect(useClientDataSWR).toHaveBeenCalledWith(null, expect.any(Function));
  });

  it('uses a distinct list cache and request for each Dataset', async () => {
    const slice = createConnectorSlice();
    slice.useFetchEvalConnectors('a');
    slice.useFetchEvalConnectors('b');
    const calls = vi.mocked(useClientDataSWR).mock.calls;
    expect(calls[0][0]).toEqual(evalKeys.connectors('a'));
    expect(calls[1][0]).toEqual(evalKeys.connectors('b'));
    expect(calls[0][0]).not.toEqual(calls[1][0]);
    await (calls[1][1] as () => Promise<unknown>)();
    expect(agentEvalService.listEvalConnectors).toHaveBeenCalledWith('b');
  });

  it('includes the Dataset in exact-ID editor requests and cache keys', async () => {
    createConnectorSlice().useFetchEvalConnector('a', 'connection');
    const [key, fetcher] = vi.mocked(useClientDataSWR).mock.calls[0];
    expect(key).toEqual(evalKeys.connector('a', 'connection'));
    await (fetcher as () => Promise<unknown>)();
    expect(agentEvalService.getEvalConnector).toHaveBeenCalledWith('a', 'connection');
  });
});
