import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openArtboardFullscreen } from './artboardLoader';

const toast = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock('@lobehub/ui', () => ({ toast }));

beforeEach(() => toast.info.mockReset());

describe('share build artboard loader', () => {
  it('tells the visitor the artboard is not shared instead of doing nothing', async () => {
    await openArtboardFullscreen('art_1');

    expect(toast.info).toHaveBeenCalledWith('This artboard isn’t shared publicly');
  });
});
