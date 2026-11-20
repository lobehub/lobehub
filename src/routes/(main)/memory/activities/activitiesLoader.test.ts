// @vitest-environment happy-dom
import type { LoaderFunctionArgs } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserMemoryStore } from '@/store/userMemory';

import { activityListLoader } from './activitiesLoader';

const argsOf = (url: string) => ({ request: new Request(url) }) as LoaderFunctionArgs;

describe('activityListLoader', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pre-hydrates the query the route URL encodes', async () => {
    const preHydrate = vi
      .spyOn(useUserMemoryStore.getState(), 'preHydrateActivities')
      .mockResolvedValue(true);

    await expect(
      activityListLoader(argsOf('https://app.lobehub.com/memory/activities?q=foo')),
    ).resolves.toBeNull();

    expect(preHydrate).toHaveBeenCalledWith({ q: 'foo' });
  });

  it('pre-hydrates the unfiltered query for a bare URL', async () => {
    const preHydrate = vi
      .spyOn(useUserMemoryStore.getState(), 'preHydrateActivities')
      .mockResolvedValue(true);

    await activityListLoader(argsOf('https://app.lobehub.com/memory/activities'));

    expect(preHydrate).toHaveBeenCalledWith({ q: undefined });
  });
});
