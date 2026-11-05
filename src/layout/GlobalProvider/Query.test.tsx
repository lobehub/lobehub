/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import useSWR from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActionSWR } from '@/libs/swr';

import QueryProvider from './Query';

const mocks = vi.hoisted(() => ({
  action: vi.fn(async () => 'done'),
  fetchData: vi.fn(async () => 'data'),
  scope: 'anon:personal',
}));

vi.mock('@/libs/swr/useCacheScope', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCacheScope: () => mocks.scope,
  useCacheScope: () => mocks.scope,
}));

vi.mock('@/libs/swr/localStorageProvider', () => ({
  swrCacheProvider: () => {
    const cache = new Map();
    const provider = () => cache;
    provider.reloadScope = async () => {};
    return provider;
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: { Provider: ({ children }: { children: React.ReactNode }) => children },
  lambdaQueryClient: {},
}));

const Consumers = () => {
  useSWR(['data-key'], mocks.fetchData);
  const { mutate } = useActionSWR(['action-key'], mocks.action);

  return <button onClick={() => mutate()}>run action</button>;
};

describe('QueryProvider scope change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope = 'anon:personal';
  });

  it('revalidates data keys without running useActionSWR actions', async () => {
    const { rerender } = render(
      <QueryProvider>
        <Consumers />
      </QueryProvider>,
    );
    await waitFor(() => expect(mocks.fetchData).toHaveBeenCalledTimes(1));

    mocks.scope = 'user-1:personal';
    rerender(
      <QueryProvider>
        <Consumers />
      </QueryProvider>,
    );

    await waitFor(() => expect(mocks.fetchData).toHaveBeenCalledTimes(2));
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it('still runs the action when its own mutate is called', async () => {
    render(
      <QueryProvider>
        <Consumers />
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'run action' }));

    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1));
  });
});
