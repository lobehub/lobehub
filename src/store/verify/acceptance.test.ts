import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientDataSWR } from '@/libs/swr';

import { useVerifyStore } from './index';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useVerifyStore.setState({ acceptanceBundleMap: {}, acceptanceBySubjectMap: {} });
});

describe('Acceptance store', () => {
  it('normalizes acceptances by subject', () => {
    useVerifyStore.getState().useFetchAcceptanceBySubject('task', 'task-1');
    const options = vi.mocked(useClientDataSWR).mock.calls[0][2] as {
      onSuccess: (value: { id: string }) => void;
    };

    options.onSuccess({ id: 'acceptance-1' });

    expect(useVerifyStore.getState().acceptanceBySubjectMap['task:task-1']).toEqual({
      id: 'acceptance-1',
    });
  });

  it('does not poll indefinitely when a subject has no acceptance', () => {
    useVerifyStore.getState().useFetchAcceptanceBySubject('task', 'task-without-acceptance');
    const options = vi.mocked(useClientDataSWR).mock.calls[0][2];

    expect(options).not.toHaveProperty('refreshInterval');
  });

  it('caches bundles by acceptance id', () => {
    useVerifyStore.getState().useFetchAcceptanceBundle('acceptance-1');
    const options = vi.mocked(useClientDataSWR).mock.calls[0][2] as {
      onSuccess: (value: { acceptance: { id: string }; checks: never[] }) => void;
    };

    options.onSuccess({ acceptance: { id: 'acceptance-1' }, checks: [] });

    expect(useVerifyStore.getState().acceptanceBundleMap['acceptance-1']).toMatchObject({
      acceptance: { id: 'acceptance-1' },
      checks: [],
    });
  });
});
