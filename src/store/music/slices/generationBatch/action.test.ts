import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generationService } from '@/services/generation';
import { useMusicStore } from '@/store/music';
import { AsyncTaskStatus } from '@/types/asyncTask';

vi.mock('@/services/generation', () => ({
  generationService: { deleteGeneration: vi.fn(), getGenerationStatus: vi.fn() },
}));
vi.mock('@/services/generationBatch', () => ({
  generationBatchService: { deleteGenerationBatch: vi.fn(), getGenerationBatches: vi.fn() },
}));

const pendingGeneration = (id: string) => ({
  asyncTaskId: `task-${id}`,
  createdAt: new Date(),
  id,
  task: { id: `task-${id}`, status: AsyncTaskStatus.Processing },
});

describe('music generationBatch status polling', () => {
  const refreshGenerationBatches = vi.fn().mockResolvedValue(undefined);
  const internal_dispatchGenerationBatch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useMusicStore.setState({
      generationBatchesMap: {
        'topic-1': [
          {
            config: { prompt: 'p' } as any,
            createdAt: new Date(),
            generations: [pendingGeneration('gen-1'), pendingGeneration('gen-2')] as any,
            id: 'batch-1',
            model: 'song-model',
            prompt: 'p',
            provider: 'fal',
          },
        ],
      },
      internal_dispatchGenerationBatch,
      refreshGenerationBatches,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps polling while the task runs and applies the song once it succeeds', async () => {
    const song = { asset: { type: 'audio', url: 'https://cdn/song.mp3' }, id: 'gen-1' };
    vi.mocked(generationService.getGenerationStatus)
      .mockResolvedValueOnce({ generation: null, status: AsyncTaskStatus.Processing } as any)
      .mockResolvedValueOnce({ generation: song, status: AsyncTaskStatus.Success } as any);

    renderHook(() =>
      useMusicStore.getState().useCheckGenerationStatus('gen-1', 'task-gen-1', 'topic-1', true),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(generationService.getGenerationStatus).toHaveBeenCalledTimes(1);
    expect(internal_dispatchGenerationBatch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(generationService.getGenerationStatus).toHaveBeenCalledTimes(2);
    expect(internal_dispatchGenerationBatch).toHaveBeenCalledWith('topic-1', {
      batchId: 'batch-1',
      generationId: 'gen-1',
      type: 'updateGenerationInBatch',
      value: song,
    });
    expect(refreshGenerationBatches).toHaveBeenCalledTimes(1);

    // Settled: no further requests
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(generationService.getGenerationStatus).toHaveBeenCalledTimes(2);
  });

  it('does not poll a settled or temporary generation', async () => {
    renderHook(() => {
      useMusicStore.getState().useCheckGenerationStatus('gen-1', 'task-gen-1', 'topic-1', false);
      useMusicStore.getState().useCheckGenerationStatus('temp-1', 'task-x', 'topic-1', true);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(generationService.getGenerationStatus).not.toHaveBeenCalled();
  });

  it('stops polling on unmount', async () => {
    vi.mocked(generationService.getGenerationStatus).mockResolvedValue({
      generation: null,
      status: AsyncTaskStatus.Processing,
    } as any);

    const { unmount } = renderHook(() =>
      useMusicStore.getState().useCheckGenerationStatus('gen-2', 'task-gen-2', 'topic-1', true),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(generationService.getGenerationStatus).toHaveBeenCalledTimes(1);
  });
});
