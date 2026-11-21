import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import type { FileService } from '@/server/services/file';

import {
  isGifFrameSheet,
  MAX_INLINE_FRAME_BYTES,
  renderGifFrameSheet,
  resolveModelReadableFrameUrl,
} from '../modelFrames';

const FRAME = 40;
const COLORS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
];

/** A 40×40 animated GIF whose frames are solid red, green, blue, yellow. */
const animatedGif = async () => {
  const frames = await Promise.all(
    COLORS.map(([r, g, b]) =>
      sharp({ create: { background: { b, g, r }, channels: 3, height: FRAME, width: FRAME } })
        .png()
        .toBuffer(),
    ),
  );
  return sharp(frames, { join: { animated: true } })
    .gif({ delay: COLORS.map(() => 100), loop: 0 })
    .toBuffer();
};

const pixel = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
};

describe('renderGifFrameSheet', () => {
  it('lays every frame of an animated GIF out on one PNG, in playback order', async () => {
    const gif = await animatedGif();
    expect((await sharp(gif).metadata()).pages).toBe(COLORS.length);

    const sheet = await renderGifFrameSheet(gif);
    expect(sheet).toBeDefined();

    const meta = await sharp(sheet!).metadata();
    expect(meta.format).toBe('png');
    // Four frames → a 2×2 grid with an 8px gap.
    expect(meta.width).toBe(FRAME * 2 + 8);
    expect(meta.height).toBe(FRAME * 2 + 8);

    const centre = FRAME / 2;
    const step = FRAME + 8;
    const sampled = await Promise.all([
      pixel(sheet!, centre, centre),
      pixel(sheet!, step + centre, centre),
      pixel(sheet!, centre, step + centre),
      pixel(sheet!, step + centre, step + centre),
    ]);
    sampled.forEach((rgb, index) => {
      rgb.forEach((channel, c) => expect(Math.abs(channel - COLORS[index][c])).toBeLessThan(40));
    });
  });
});

describe('resolveModelReadableFrameUrl', () => {
  const fileServiceFor = (bytes: Uint8Array) =>
    ({
      getFileAccessUrl: vi.fn(async () => 'https://files.example/frame'),
      getFileByteArray: vi.fn(async () => bytes),
    }) as unknown as FileService;

  it('sends a GIF as a PNG frame sheet instead of the raw animation', async () => {
    const gif = await animatedGif();
    const url = await resolveModelReadableFrameUrl(fileServiceFor(gif), {
      fileType: 'image/gif',
      id: 'file_gif',
      size: gif.length,
      url: 'files/recording.gif',
    });

    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(isGifFrameSheet('gif', url)).toBe(true);
  });

  it('still sends a GIF as a sheet when it is past the inline limits', async () => {
    const gif = await animatedGif();
    const fileService = fileServiceFor(gif);
    const url = await resolveModelReadableFrameUrl(
      fileService,
      // Larger than one inline frame, and the request's budget is already spent.
      { fileType: 'image/gif', id: 'file_big', size: MAX_INLINE_FRAME_BYTES + 1, url: 'big.gif' },
      false,
    );

    expect(isGifFrameSheet('gif', url)).toBe(true);
    expect(fileService.getFileAccessUrl).not.toHaveBeenCalled();
  });

  it('keeps a PNG screenshot as-is', async () => {
    const png = await sharp({
      create: { background: '#ff0000', channels: 3, height: 4, width: 4 },
    })
      .png()
      .toBuffer();
    const url = await resolveModelReadableFrameUrl(fileServiceFor(png), {
      fileType: 'image/png',
      id: 'file_png',
      size: png.length,
      url: 'files/shot.png',
    });

    expect(url).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(isGifFrameSheet('screenshot', url)).toBe(false);
  });
});
