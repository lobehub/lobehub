import { afterEach, describe, expect, it, vi } from 'vitest';

import { artboardActions, useArtboardStore } from '../store';
import { onArtboardToolResult } from './onArtboardToolResult';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@/libs/swr', () => ({ mutate, useClientDataSWR: vi.fn() }));

const state = { artboardId: 'art_1', changedIds: ['f2'], revision: 4 };

describe('onArtboardToolResult', () => {
  afterEach(() => {
    artboardActions.reset();
    vi.clearAllMocks();
  });

  it('refreshes the board cache from the tool result with no board on screen', async () => {
    await onArtboardToolResult({ apiName: 'updateArtboard', result: { state, success: true } });

    expect(mutate).toHaveBeenCalledWith(['artboard', 'art_1']);
    expect(useArtboardStore.getState().flash).toEqual([]);
  });

  it('flashes the changed items on the open board', async () => {
    artboardActions.bindBoard('art_1');

    await onArtboardToolResult({ apiName: 'createArtboard', result: { state, success: true } });

    expect(useArtboardStore.getState().flash).toEqual(['f2']);
  });

  it('ignores failed writes and reads', async () => {
    await onArtboardToolResult({ apiName: 'updateArtboard', result: { state, success: false } });
    await onArtboardToolResult({ apiName: 'readArtboard', result: { state, success: true } });

    expect(mutate).not.toHaveBeenCalled();
  });
});
