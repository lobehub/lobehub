import { afterEach, describe, expect, it, vi } from 'vitest';

import { artboardActions, useArtboardStore } from '../store';
import { finalizeBoard } from './finalizeBoard';

const { finalize, mutate } = vi.hoisted(() => ({ finalize: vi.fn(), mutate: vi.fn() }));
vi.mock('@/libs/swr', () => ({ mutate, useClientDataSWR: vi.fn() }));
vi.mock('@/services/artboard', () => ({ artboardService: { finalize } }));

describe('finalizeBoard', () => {
  afterEach(() => {
    artboardActions.reset();
    vi.clearAllMocks();
  });

  it('switches to acceptance as soon as finalize succeeds, before the message is sent', async () => {
    finalize.mockResolvedValue({ acceptanceId: 'acc_1', artboard: { id: 'art_1' } });
    let release!: () => void;
    const announce = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));

    const result = await finalizeBoard({ announce, artboardId: 'art_1', revision: 3 });

    expect(result.acceptanceId).toBe('acc_1');
    expect(useArtboardStore.getState().mode).toBe('verify');
    expect(announce).toHaveBeenCalledWith('acc_1');
    release();
  });

  it('keeps the board finalized when the follow-up message fails', async () => {
    finalize.mockResolvedValue({ acceptanceId: 'acc_1', artboard: { id: 'art_1' } });
    const announce = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      finalizeBoard({ announce, artboardId: 'art_1', revision: 3 }),
    ).resolves.toMatchObject({ acceptanceId: 'acc_1' });
    expect(useArtboardStore.getState().mode).toBe('verify');
  });

  it('stays in discussion and sends nothing when finalize is refused', async () => {
    finalize.mockRejectedValue(new Error('blocked'));
    const announce = vi.fn();

    await expect(finalizeBoard({ announce, artboardId: 'art_1', revision: 3 })).rejects.toThrow(
      'blocked',
    );
    expect(useArtboardStore.getState().mode).toBe('discuss');
    expect(announce).not.toHaveBeenCalled();
  });
});
