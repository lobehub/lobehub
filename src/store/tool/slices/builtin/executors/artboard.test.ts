import { describe, expect, it, vi } from 'vitest';

const { onArtboardToolResult } = vi.hoisted(() => ({ onArtboardToolResult: vi.fn() }));
vi.mock('@/features/Artboard/data/onArtboardToolResult', () => ({ onArtboardToolResult }));

const { artboardHookExecutor } = await import('./artboard');

describe('artboardHookExecutor', () => {
  it('hands every artboard tool_end to the board refresh', async () => {
    const result = { state: { artboardId: 'art_1' }, success: true };

    await artboardHookExecutor.onAfterCall({
      apiName: 'updateArtboard',
      identifier: 'lobe-artboard',
      params: {},
      result,
    });

    expect(onArtboardToolResult).toHaveBeenCalledWith({ apiName: 'updateArtboard', result });
    expect(artboardHookExecutor.getApiNames()).toEqual([]);
  });
});
