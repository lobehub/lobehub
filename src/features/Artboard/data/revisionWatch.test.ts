import { afterEach, describe, expect, it, vi } from 'vitest';

import { artboardActions } from '../store';
import { checkArtboardRevision } from './revisionWatch';

const { getRevision, mutate } = vi.hoisted(() => ({ getRevision: vi.fn(), mutate: vi.fn() }));
vi.mock('@/libs/swr', () => ({ mutate, useClientDataSWR: vi.fn() }));
vi.mock('@/services/artboard', () => ({ artboardService: { getRevision } }));

const shown = { revision: 3, updatedAt: new Date('2026-11-18T10:00:00Z') };

describe('artboard revision watch', () => {
  afterEach(() => {
    artboardActions.reset();
    vi.clearAllMocks();
  });

  it('reloads the open board in place when the server has a newer revision', async () => {
    artboardActions.bindBoard('art_1');
    getRevision.mockResolvedValue({ revision: 5, updatedAt: new Date('2026-11-18T11:00:00Z') });

    await checkArtboardRevision('art_1', shown);

    expect(mutate).toHaveBeenCalledWith(['artboard', 'art_1']);
  });

  it('stays quiet when the board already shows the latest revision', async () => {
    artboardActions.bindBoard('art_1');
    getRevision.mockResolvedValue(shown);

    await checkArtboardRevision('art_1', shown);

    expect(mutate).not.toHaveBeenCalled();
  });

  it('reloads the open board in place when only its files changed', async () => {
    artboardActions.bindBoard('art_1');
    getRevision.mockResolvedValue({ revision: 3, updatedAt: new Date('2026-11-18T10:05:00Z') });

    await checkArtboardRevision('art_1', shown);

    expect(mutate).toHaveBeenCalledWith(['artboard', 'art_1']);
  });

  it('ignores the answer when another board opened meanwhile', async () => {
    artboardActions.bindBoard('art_1');
    getRevision.mockImplementation(async () => {
      artboardActions.bindBoard('art_2');
      return { revision: 9, updatedAt: new Date('2026-11-18T12:00:00Z') };
    });

    await checkArtboardRevision('art_1', shown);

    expect(mutate).not.toHaveBeenCalled();
  });
});
