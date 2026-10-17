// @vitest-environment happy-dom
import type { LoaderFunctionArgs } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserMemoryStore } from '@/store/userMemory';

import { contextListLoader } from './contextsLoader';

const argsOf = (url: string) => ({ request: new Request(url) }) as LoaderFunctionArgs;

describe('contextListLoader', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pre-hydrates the query the route URL encodes', async () => {
    const preHydrate = vi
      .spyOn(useUserMemoryStore.getState(), 'preHydrateContexts')
      .mockResolvedValue(true);

    await expect(
      contextListLoader(argsOf('https://app.lobehub.com/memory/contexts?q=foo')),
    ).resolves.toBeNull();

    expect(preHydrate).toHaveBeenCalledWith({ q: 'foo' });
  });

  it('pre-hydrates the unfiltered query for a bare URL', async () => {
    const preHydrate = vi
      .spyOn(useUserMemoryStore.getState(), 'preHydrateContexts')
      .mockResolvedValue(true);

    await contextListLoader(argsOf('https://app.lobehub.com/memory/contexts'));

    expect(preHydrate).toHaveBeenCalledWith({ q: undefined });
  });
});
