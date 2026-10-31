import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Page } from '@playwright/test';

/** Detached browser canvases decode PNGs; no image packages or network needed. */
export const compareImagesInPage = async (encoded: string[]) => {
  const images = await Promise.all(
    encoded.map(async (value) => {
      const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }),
  );
  if (images.length !== 3) throw new Error('SCREENSHOT_CONTROL_REQUIRES_THREE_IMAGES');
  const compare = (left: (typeof images)[number], right: (typeof images)[number]) => {
    if (left.canvas.width !== right.canvas.width || left.canvas.height !== right.canvas.height)
      throw new Error('SCREENSHOT_DIMENSIONS_CHANGED');
    let changed = 0;
    let maxChannelDelta = 0;
    const mask = new Uint8ClampedArray(left.pixels.length);
    for (let offset = 0; offset < left.pixels.length; offset += 4) {
      let different = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(left.pixels[offset + channel] - right.pixels[offset + channel]);
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        different ||= delta !== 0;
      }
      if (different) changed++;
      mask.set(different ? [255, 0, 128, 255] : [255, 255, 255, 255], offset);
    }
    const context = right.canvas.getContext('2d')!;
    context.putImageData(new ImageData(mask, right.canvas.width, right.canvas.height), 0, 0);
    return {
      changedPixels: changed,
      maxChannelDelta,
      pixels: left.pixels.length / 4,
      heatmap: right.canvas.toDataURL('image/png').split(',')[1],
    };
  };
  const control = compare(images[0], images[1]);
  const candidate = compare(images[0], images[2]);
  return {
    candidate,
    control: { changedPixels: control.changedPixels, maxChannelDelta: control.maxChannelDelta },
    height: images[0].canvas.height,
    width: images[0].canvas.width,
  };
};

/** Viewport-only diagnostic. Pixel equality never overrides a computed-style failure. */
export const captureScreenshotEvidence = async (pages: Page[], output: string, name: string) => {
  if (pages.length !== 3 || !/^[a-z\d-]+$/i.test(name))
    throw new Error('INVALID_SCREENSHOT_REQUEST');
  for (const page of pages) {
    const viewport = page.viewportSize();
    if (!viewport || viewport.width * viewport.height > 4_000_000)
      throw new Error('SCREENSHOT_PIXEL_BUDGET_EXCEEDED');
  }
  const images = await Promise.all(
    pages.map((page) =>
      page.screenshot({
        animations: 'allow',
        caret: 'hide',
        fullPage: false,
        type: 'png',
      }),
    ),
  );
  const comparison = await pages[0].evaluate(
    compareImagesInPage,
    images.map((image) => image.toString('base64')),
  );
  const files = ['base', 'aa', 'candidate'].map((side) => `${name}-${side}.png`);
  await Promise.all(
    images.map((image, index) => writeFile(path.join(output, files[index]), image, { flag: 'wx' })),
  );
  const heatmap = `${name}-diff.png`;
  await writeFile(path.join(output, heatmap), Buffer.from(comparison.candidate.heatmap, 'base64'), {
    flag: 'wx',
  });
  const { heatmap: _, ...candidate } = comparison.candidate;
  return {
    aaStable: comparison.control.changedPixels === 0,
    artifactFiles: [...files, heatmap],
    candidate,
    control: comparison.control,
    height: comparison.height,
    scope: 'current-viewport-only' as const,
    width: comparison.width,
  };
};
