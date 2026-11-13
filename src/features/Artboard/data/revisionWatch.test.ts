import { afterEach, describe, expect, it, vi } from 'vitest';

import { artboardActions, useArtboardStore } from '../store';
import { checkArtboardRevision, refreshStaleArtboard } from './revisionWatch';

const { getRevision, mutate } = vi.hoisted(() => ({ getRevision: vi.fn(), mutate: vi.fn() }));
vi.mock('@/libs/swr', () => ({ mutate, useClientDataSWR: vi.fn() }));
vi.mock('@/services/artboard', () => ({ artboardService: { getRevision } }));

describe('artboard revision watch', () => {
  afterEach(() => {
    artboardActions.reset();
    vi.clearAllMocks();
  });

  it('flags the open board stale when the server has a newer revision', async () => {
    artboardActions.bindBoard('art_1');
    getRevision.mockResolvedValue(5);

    await checkArtboardRevision('art_1', 3);

    expect(useArtboardStore.getState().staleRevision).toBe(5);
  });

  it('stays quiet when the board already shows the latest revision', async () => {
    artboardActions.bindBoard('art_1');
    getRevision.mockResolvedValue(3);

    await checkArtboardRevision('art_1', 3);

    expect(useArtboardStore.getState().staleRevision).toBeNull();
  });

  it('ignores the answer when another board opened meanwhile', async () => {
    artboardActions.bindBoard('art_1');
    getRevision.mockImplementation(async () => {
      artboardActions.bindBoard('art_2');
      return 9;
    });

    await checkArtboardRevision('art_1', 3);

    expect(useArtboardStore.getState().staleRevision).toBeNull();
  });

  it('reloads the board and clears the banner on refresh', async () => {
    artboardActions.bindBoard('art_1');
    getRevision.mockResolvedValue(5);
    await checkArtboardRevision('art_1', 3);

    await refreshStaleArtboard('art_1');

    expect(mutate).toHaveBeenCalled();
    expect(useArtboardStore.getState().staleRevision).toBeNull();
  });
});
