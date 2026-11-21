import type { Browser, Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '../capture/browser';
import { REVEAL_COLORS, revealCase } from './reveal';

let browser: Browser;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser?.close();
});

const CASE = 'a.tsx|A#0|0';

const openClipped = async () => {
  const page = await browser.newPage({ viewport: { height: 200, width: 400 } });
  await page.setContent(`<!doctype html><html><head><style>
body { margin: 0; background: #fff; }
.lane { position: relative; overflow: hidden; }
.t { position: absolute; top: 0; left: 0; width: 40px; height: 40px; background: #00ff00; }
</style></head><body>
<section data-case="${CASE}" style="box-sizing:border-box;width:360px;padding:40px;position:relative">
<div data-synthetic-element="A#0" class="lane"><div data-synthetic-element="A#1" class="t"></div></div>
</section></body></html>`);
  return page;
};

const open = async (targetCss: string) => {
  const page = await browser.newPage({ viewport: { height: 200, width: 400 } });
  await page.setContent(`<!doctype html><html><head><style>
body { margin: 0; background: #fff; }
.t { ${targetCss} }
</style></head><body>
<section data-case="${CASE}" style="box-sizing:border-box;width:360px;padding:40px;position:relative">
<div data-synthetic-element="A#0"><div data-synthetic-element="A#1" class="t"></div></div>
</section></body></html>`);
  return page;
};

const pixels = (page: Page, image: Buffer, points: Array<[number, number]>) =>
  page.evaluate(
    async ({ data, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0);
      return points.map(([x, y]) => {
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
      });
    },
    { data: image.toString('base64'), points },
  );

const hex = (color: string) => color.toLowerCase();

const column = (x: number, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index): [number, number] => [x, from + index]);

describe('revealCase', () => {
  it('makes a white box on a white page visible and outlines it', async () => {
    const page = await open('width: 40px; height: 40px; background: #fff;');
    const clip = { height: 120, width: 120, x: 0, y: 0 };
    const before = await pixels(page, await page.screenshot({ clip }), [
      [5, 5],
      [60, 60],
    ]);
    expect(before).toEqual(['#ffffff', '#ffffff']);

    expect(await revealCase(page, CASE, 'root.0.0')).toBe(true);
    const [backdrop, inside, ...edge] = await pixels(page, await page.screenshot({ clip }), [
      [5, 5],
      [60, 60],
      ...column(37, 42, 78),
    ]);
    expect(backdrop).not.toBe('#ffffff');
    expect(inside).toBe('#ffffff');
    const [outsideSection] = await pixels(
      page,
      await page.screenshot({ clip: { height: 40, width: 40, x: 360, y: 150 } }),
      [[20, 20]],
    );
    expect(outsideSection).not.toBe('#ffffff');
    expect(edge).toContain(hex(REVEAL_COLORS.element));
    await page.close();
  });

  it('outlines a pseudo-element of the target', async () => {
    const page = await open(
      "position: relative; width: 40px; height: 40px; &::before { content: ''; position: absolute; left: 50px; top: 0; width: 20px; height: 20px; background: #fff; }",
    );
    await revealCase(page, CASE, 'root.0.0');
    const edge = await pixels(
      page,
      await page.screenshot({ clip: { height: 120, width: 200, x: 0, y: 0 } }),
      column(87, 41, 59),
    );
    expect(edge).toContain(hex(REVEAL_COLORS.pseudo));
    await page.close();
  });

  it('shows a target clipped by an ancestor that collapsed to zero height', async () => {
    const page = await openClipped();
    const clip = { height: 120, width: 120, x: 0, y: 0 };
    const [before] = await pixels(page, await page.screenshot({ clip }), [[60, 60]]);
    expect(before).toBe('#ffffff');
    await revealCase(page, CASE, 'root.0.0');
    const [after] = await pixels(page, await page.screenshot({ clip }), [[60, 60]]);
    expect(after).toBe('#00ff00');
    await page.close();
  });

  it('reports a target key that does not exist', async () => {
    const page = await open('width: 40px; height: 40px;');
    expect(await revealCase(page, CASE, 'root.4')).toBe(false);
    await page.close();
  });
});
