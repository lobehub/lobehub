import type { ArtboardContent } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { moveBoardItem } from './moveBoardItem';

const { applyUserOps, get, mutate } = vi.hoisted(() => ({
  applyUserOps: vi.fn(),
  get: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock('@/libs/swr', () => ({ mutate, useClientDataSWR: vi.fn() }));
vi.mock('@/services/artboard', () => ({ artboardService: { applyUserOps, get } }));

const content = (frameIds: string[]): ArtboardContent => ({
  arrows: [],
  frames: frameIds.map((id) => ({
    groupId: 'g1',
    id,
    source: { fileId: 'file_1', kind: 'image' as const },
    title: id,
    x: 0,
    y: 0,
  })),
  groups: [{ desc: '', id: 'g1', kind: 'journey', title: '旅程' }],
  notes: [],
});

const view = (revision: number, frameIds = ['f1', 'f2']) =>
  ({
    artboard: { content: content(frameIds), id: 'art_1', revision },
    imageUrls: {},
  }) as any;

const conflict = () =>
  TRPCClientError.from({ error: { code: -32_009, data: { code: 'CONFLICT' }, message: 'stale' } });

describe('moveBoardItem', () => {
  afterEach(() => vi.clearAllMocks());

  it('moves the frame locally before the server answers', async () => {
    applyUserOps.mockResolvedValue({ artboard: { revision: 4 }, changedIds: ['f1'] });

    await moveBoardItem(view(3), 'f1', 120, 80);

    const optimistic = mutate.mock.calls[0][1];
    expect(optimistic.artboard.content.frames[0]).toMatchObject({ id: 'f1', x: 120, y: 80 });
    expect(applyUserOps).toHaveBeenCalledWith('art_1', 3, [
      { id: 'f1', type: 'moveItem', x: 120, y: 80 },
    ]);
  });

  it('re-reads on a stale revision and submits the move again on the new one', async () => {
    applyUserOps.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ changedIds: ['f1'] });
    get.mockResolvedValue(view(5));

    await moveBoardItem(view(3), 'f1', 120, 80);

    expect(applyUserOps).toHaveBeenLastCalledWith('art_1', 5, [
      { id: 'f1', type: 'moveItem', x: 120, y: 80 },
    ]);
  });

  it('drops the move when the agent deleted that frame meanwhile', async () => {
    applyUserOps.mockRejectedValueOnce(conflict());
    get.mockResolvedValue(view(5, ['f2']));

    await moveBoardItem(view(3), 'f1', 120, 80);

    expect(applyUserOps).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenLastCalledWith(['artboard', 'art_1'], view(5, ['f2']), {
      revalidate: false,
    });
  });
});
