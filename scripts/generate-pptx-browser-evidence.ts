import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import JSZip from 'jszip';

const root = process.cwd();
const directory = path.join(root, 'artifacts/t-326-pptx');
const bundlePath = path.join(directory, 'editor-browser.js');
await mkdir(directory, { recursive: true });
await copyFile(
  path.join(root, 'packages/file-loaders/src/loaders/pptx/fixtures/test.pptx'),
  path.join(directory, 'before.pptx'),
);
await copyFile(
  path.join(root, 'public/app-icons/icon-192x192.png'),
  path.join(directory, 'evidence-image.png'),
);

await build({
  bundle: true,
  format: 'iife',
  outfile: bundlePath,
  platform: 'browser',
  stdin: {
    contents: `
      import { editPptx } from './src/features/FileViewer/Renderer/PPTX/pptxOperations';
      window.generateEditedDeck = async () => {
        let bytes = await (await fetch('./before.pptx')).arrayBuffer();
        const frame = { h: 1300000, w: 4600000, x: 1200000, y: 900000 };
        bytes = await editPptx(bytes, { frame, slideIndex: 0, text: 'PPT editing fidelity', type: 'addText' });
        bytes = await editPptx(bytes, { fill: '#1677FF', frame: { ...frame, h: 900000, y: 2500000 }, shape: 'roundRect', slideIndex: 0, type: 'addShape' });
        bytes = await editPptx(bytes, { chart: { categories: ['Preview', 'Reopen', 'Export'], values: [98, 98, 98] }, frame: { h: 4000000, w: 8000000, x: 12000000, y: 2000000 }, slideIndex: 0, type: 'addChart' });
        const png = await (await fetch('./evidence-image.png')).arrayBuffer();
        bytes = await editPptx(bytes, { bytes: png, fileName: 'evidence-image.png', frame: { h: 1800000, w: 1800000, x: 9800000, y: 700000 }, mimeType: 'image/png', slideIndex: 0, type: 'addImage' });
        bytes = await editPptx(bytes, { slideIndex: 0, type: 'duplicateSlide' });
        bytes = await editPptx(bytes, { fromIndex: 1, toIndex: 0, type: 'moveSlide' });
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(new Blob([bytes]));
        });
      };
    `,
    loader: 'js',
    resolveDir: root,
  },
});
await writeFile(
  path.join(directory, 'editor-browser.html'),
  '<!doctype html><script src="./editor-browser.js"></script>',
);

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname.slice(1);
  try {
    response.end(await readFile(path.join(directory, pathname || 'editor-browser.html')));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(4180, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4180/editor-browser.html');
  const base64 = await page.evaluate(async () =>
    (window as typeof window & { generateEditedDeck: () => Promise<string> }).generateEditedDeck(),
  );
  const output = Buffer.from(base64, 'base64');
  await writeFile(path.join(directory, 'after.pptx'), output);
  const inspect = async (input: Buffer) => {
    const zip = await JSZip.loadAsync(input, { checkCRC32: true });
    await Promise.all(
      Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => entry.async('uint8array')),
    );
    const paths = Object.keys(zip.files);
    return {
      allEntriesPassCrc32: true,
      chartParts: paths.filter((entry) => /^ppt\/charts\/chart\d+\.xml$/u.test(entry)).length,
      entryCount: paths.filter((entry) => !zip.files[entry].dir).length,
      mediaParts: paths.filter((entry) => /^ppt\/media\/[^/]+$/u.test(entry)).length,
      slideCount: paths.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/u.test(entry)).length,
      textPreserved: await Promise.all(
        paths
          .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/u.test(entry))
          .map((entry) => zip.file(entry)!.async('text')),
      ).then((slides) => slides.some((slide) => slide.includes('PPT editing fidelity'))),
    };
  };
  const before = await inspect(await readFile(path.join(directory, 'before.pptx')));
  const after = await inspect(output);
  const report = { after, before, pageDelta: after.slideCount - before.slideCount };
  await writeFile(
    path.join(directory, 'package-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`browser-native OOXML export: ${Buffer.byteLength(base64, 'base64')} bytes`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.close();
}
