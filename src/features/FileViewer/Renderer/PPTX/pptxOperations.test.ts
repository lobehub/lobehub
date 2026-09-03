import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseZip } from '@aiden0z/pptx-renderer';
import JSZip from 'jszip';
import { DOMParser as LinkedomDOMParser } from 'linkedom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { editPptx, inspectPptxPackage, preparePptxForEditing } from './pptxOperations';

beforeAll(() => {
  vi.stubGlobal('DOMParser', LinkedomDOMParser);
});

const fixture = path.resolve(
  process.cwd(),
  'packages/file-loaders/src/loaders/pptx/fixtures/test.pptx',
);

const loadFixture = async () => {
  const file = await readFile(fixture);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};

const reopen = async (bytes: ArrayBuffer) => {
  const files = await parseZip(bytes);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  await Promise.all(
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.async('uint8array')),
  );
  return { files, zip };
};

describe('PPTX OOXML editing', () => {
  it('materializes inherited placeholder geometry before preview and export', async () => {
    const prepared = await preparePptxForEditing(await loadFixture());
    const { files } = await reopen(prepared);
    const firstSlide = Array.from(files.slides.values())[0];

    expect(firstSlide).toContain('name="Page1"');
    expect(firstSlide).toContain('<a:off x="1206500" y="2616200"');
    expect(firstSlide).toContain('<a:ext cx="21971004" cy="4648200"');
  });

  it('preserves a multi-slide deck through element, layout, order, and export operations', async () => {
    let bytes = await loadFixture();
    const initial = await reopen(bytes);
    const initialPackage = await inspectPptxPackage(bytes);
    const frame = { h: 1_200_000, w: 3_600_000, x: 1_000_000, y: 800_000 };

    bytes = await editPptx(bytes, {
      frame,
      slideIndex: 0,
      text: 'T-326 fidelity proof',
      type: 'addText',
    });
    bytes = await editPptx(bytes, {
      fill: '#16A34A',
      frame: { ...frame, y: frame.y + frame.h },
      shape: 'roundRect',
      slideIndex: 0,
      type: 'addShape',
    });
    bytes = await editPptx(bytes, {
      bytes: Uint8Array.from([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31,
        0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
      ]).buffer,
      fileName: 'proof.png',
      frame: { ...frame, x: frame.x + frame.w },
      mimeType: 'image/png',
      slideIndex: 0,
      type: 'addImage',
    });
    bytes = await editPptx(bytes, {
      chart: { categories: ['Preview', 'Export'], values: [98, 98] },
      frame: { ...frame, h: frame.h * 2, w: frame.w * 1.5 },
      slideIndex: 0,
      type: 'addChart',
    });

    let edited = await reopen(bytes);
    const editedSlide = edited.files.slides.get(initialPackage.slidePaths[0])!;
    const addedTextId = editedSlide.match(/cNvPr id="(\d+)" name="TextBox \d+"/u)?.[1];
    const addedShapeId = editedSlide.match(/cNvPr id="(\d+)" name="Shape \d+"/u)?.[1];
    const addedChartId = editedSlide.match(/cNvPr id="(\d+)" name="Chart \d+"/u)?.[1];
    expect(addedTextId).toBeDefined();
    expect(addedShapeId).toBeDefined();
    expect(addedChartId).toBeDefined();
    expect(editedSlide).toContain('<p:pic>');
    expect(editedSlide).toContain('<p:graphicFrame>');
    const initialFallback = Array.from(edited.files.media.entries()).find(([path]) =>
      path.includes('chartFallback'),
    )?.[1];

    bytes = await editPptx(bytes, {
      nodeId: addedTextId!,
      slideIndex: 0,
      text: 'Edited, saved, reopened',
      type: 'setText',
    });
    bytes = await editPptx(bytes, {
      align: 'ctr',
      bold: true,
      color: '#C2410C',
      fontSize: 28,
      nodeId: addedTextId!,
      slideIndex: 0,
      type: 'formatText',
    });
    const movedFrame = { h: frame.h * 1.2, w: frame.w * 1.1, x: frame.x + 120, y: frame.y + 80 };
    bytes = await editPptx(bytes, {
      frame: movedFrame,
      nodeId: addedTextId!,
      slideIndex: 0,
      type: 'setFrame',
    });
    const movedChartFrame = { h: 2_400_000, w: 5_400_000, x: 6_000_000, y: 1_400_000 };
    bytes = await editPptx(bytes, {
      chart: { categories: ['Saved', 'Reopened'], values: [97, 99] },
      nodeId: addedChartId!,
      slideIndex: 0,
      type: 'setChartData',
    });
    bytes = await editPptx(bytes, {
      frame: movedChartFrame,
      nodeId: addedChartId!,
      slideIndex: 0,
      type: 'setFrame',
    });
    bytes = await editPptx(bytes, { nodeId: addedShapeId!, slideIndex: 0, type: 'deleteElement' });
    bytes = await editPptx(bytes, { slideIndex: 0, type: 'duplicateSlide' });
    bytes = await editPptx(bytes, { fromIndex: 1, toIndex: 0, type: 'moveSlide' });

    edited = await reopen(bytes);
    const layoutPath = Array.from(edited.files.slideLayouts.keys())[0];
    bytes = await editPptx(bytes, { layoutPath, slideIndex: 0, type: 'setSlideLayout' });
    const finalDeck = await reopen(bytes);
    const finalPackage = await inspectPptxPackage(bytes);
    const finalSlide = finalDeck.files.slides.get(finalPackage.slidePaths[0])!;

    expect(finalPackage.slideCount).toBe(initialPackage.slideCount + 1);
    expect(finalPackage.entryCount).toBeGreaterThan(initialPackage.entryCount);
    expect(finalDeck.files.slides.size).toBe(initial.files.slides.size + 1);
    expect(finalSlide).toContain(`x="${Math.round(movedFrame.x)}" y="${Math.round(movedFrame.y)}"`);
    expect(finalSlide).toContain(
      `cx="${Math.round(movedFrame.w)}" cy="${Math.round(movedFrame.h)}"`,
    );
    expect(finalSlide).toContain('Edited, saved, reopened');
    expect(finalSlide).not.toContain(`name="Shape ${addedShapeId}"`);
    expect(finalDeck.files.charts.size).toBeGreaterThan(initial.files.charts.size);
    expect(finalDeck.files.media.size).toBeGreaterThan(initial.files.media.size);
    expect(finalSlide).toContain('C2410C');
    expect(finalSlide).toContain('b="1"');
    expect(finalSlide).toContain(`name="Chart Fallback ${addedChartId}"`);
    expect(finalSlide.split(`x="${movedChartFrame.x}" y="${movedChartFrame.y}"`).length - 1).toBe(
      2,
    );
    const chartXml = Array.from(finalDeck.files.charts.values())[0];
    expect(chartXml).toContain('<c:strLit>');
    expect(chartXml).toContain('<c:numLit>');
    expect(chartXml).not.toContain('<c:strRef>');
    expect(chartXml).not.toContain('<c:numRef>');
    const fallbackBytes = Array.from(finalDeck.files.media.entries()).find(([path]) =>
      path.includes('chartFallback'),
    )?.[1];
    expect(Array.from(fallbackBytes!.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(fallbackBytes).not.toEqual(initialFallback);
  });

  it('refuses to delete the last slide instead of producing a corrupt presentation', async () => {
    let bytes = await loadFixture();
    const { slideCount } = await inspectPptxPackage(bytes);
    for (let index = slideCount - 1; index > 0; index -= 1) {
      bytes = await editPptx(bytes, { slideIndex: index, type: 'deleteSlide' });
    }
    await expect(editPptx(bytes, { slideIndex: 0, type: 'deleteSlide' })).rejects.toThrow(
      'at least one slide',
    );
    await expect(inspectPptxPackage(bytes)).resolves.toMatchObject({ slideCount: 1 });
    await expect(reopen(bytes)).resolves.toBeDefined();
  });
});
