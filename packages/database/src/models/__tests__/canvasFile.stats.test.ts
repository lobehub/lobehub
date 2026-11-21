// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { CanvasFileModel } from '../canvasFile';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'canvas-file-stats-user';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CanvasFileModel.summarizeByCanvas', () => {
  it('reports 0 bytes for a canvas whose rows carry no usable size', async () => {
    // `files.size` is `notNull`, so `sum(size)` in Postgres returns a number for
    // every group; a driver that hands back null must still be reported as 0
    // bytes rather than surfacing null to the canvas list.
    const orderBy = vi
      .fn()
      .mockResolvedValue([
        { canvasId: 'canvas-without-size', fileCount: 1, totalSize: null, updatedAt: null },
      ]);
    vi.spyOn(serverDB, 'select').mockReturnValueOnce({
      from: () => ({ where: () => ({ groupBy: () => ({ orderBy }) }) }),
    } as unknown as ReturnType<LobeChatDatabase['select']>);

    const rows = await new CanvasFileModel(serverDB, userId).summarizeByCanvas();

    expect(rows).toEqual([
      {
        canvasId: 'canvas-without-size',
        fileCount: 1,
        totalSize: 0,
        updatedAt: null,
      },
    ]);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });
});
