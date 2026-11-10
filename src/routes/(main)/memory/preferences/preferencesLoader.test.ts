// @vitest-environment happy-dom
import type { LoaderFunctionArgs } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserMemoryStore } from '@/store/userMemory';

import { preferenceListLoader } from './preferencesLoader';

const argsOf = (url: string) => ({ request: new Request(url) }) as LoaderFunctionArgs;

describe('preferenceListLoader', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pre-hydrates the query the route URL encodes', async () => {
    const preHydrate = vi
      .spyOn(useUserMemoryStore.getState(), 'preHydratePreferences')
      .mockResolvedValue(true);

    await expect(
      preferenceListLoader(argsOf('https://app.lobehub.com/memory/preferences?q=foo')),
    ).resolves.toBeNull();

    expect(preHydrate).toHaveBeenCalledWith({ q: 'foo' });
  });

  it('pre-hydrates the unfiltered query for a bare URL', async () => {
    const preHydrate = vi
      .spyOn(useUserMemoryStore.getState(), 'preHydratePreferences')
      .mockResolvedValue(true);

    await preferenceListLoader(argsOf('https://app.lobehub.com/memory/preferences'));

    expect(preHydrate).toHaveBeenCalledWith({ q: undefined });
  });
});
