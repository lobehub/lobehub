import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { chromium } from '@playwright/test';
import { build } from 'esbuild';

const root = process.cwd();
const directory = path.join(root, 'artifacts/t-326-pptx');
const bundlePath = path.join(directory, 'renderer.js');
const htmlPath = path.join(directory, 'renderer.html');

await build({
  bundle: true,
  format: 'esm',
  outfile: bundlePath,
  platform: 'browser',
  stdin: {
    contents: `
      import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer/browser';
      const file = new URLSearchParams(location.search).get('file');
      const response = await fetch(file);
      const viewer = await PptxViewer.open(await response.arrayBuffer(), document.querySelector('#deck'), {
        fitMode: 'contain',
        renderMode: 'list',
        width: 960,
        zipLimits: RECOMMENDED_ZIP_LIMITS,
        listOptions: { windowed: false, showSlideLabels: true },
        pdfjs: false,
      });
      document.body.dataset.ready = String(viewer.slideCount);
    `,
    loader: 'js',
    resolveDir: root,
  },
});
await writeFile(
  htmlPath,
  '<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#e9eaed;font:16px system-ui}#deck{width:960px;margin:auto}</style><div id="deck"></div><script type="module" src="./renderer.js"></script>',
);

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const filePath = path.join(directory, pathname === '/' ? 'renderer.html' : pathname.slice(1));
  try {
    const body = await readFile(filePath);
    response.setHeader(
      'content-type',
      pathname.endsWith('.js')
        ? 'text/javascript'
        : pathname.endsWith('.pptx')
          ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : 'text/html',
    );
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end('not found');
  }
});
await new Promise<void>((resolve) => server.listen(4179, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 800, width: 1100 },
  });
  page.on(
    'console',
    (message) => message.type() === 'error' && console.log(`browser-console: ${message.text()}`),
  );
  page.on('pageerror', (error) => console.log(`browser-error: ${error.message}`));
  for (const name of ['before', 'after']) {
    await page.goto(`http://127.0.0.1:4179/renderer.html?file=${name}.pptx`);
    await page.waitForFunction(() => Number(document.body.dataset.ready) > 0);
    await page.screenshot({ fullPage: true, path: path.join(directory, `${name}.png`) });
    console.log(
      `${name}: slides=${await page.locator('[data-slide-index]').count()}, renderedNodes=${await page.locator('svg, img, [style*="position: absolute"]').count()}, text=${JSON.stringify((await page.locator('#deck').innerText()).slice(0, 120))}, height=${await page.evaluate(() => document.body.scrollHeight)}`,
    );
    if (name === 'after') {
      console.log(
        JSON.stringify(
          await page.evaluate(() =>
            Array.from(document.querySelectorAll('*'))
              .filter((element) => element.textContent?.trim() === 'Page1')
              .map((element) => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return {
                  color: style.color,
                  display: style.display,
                  height: rect.height,
                  opacity: style.opacity,
                  overflow: style.overflow,
                  tag: element.tagName,
                  visibility: style.visibility,
                  width: rect.width,
                  x: rect.x,
                  y: rect.y,
                };
              }),
          ),
          null,
          2,
        ),
      );
    }
  }
} finally {
  await browser.close();
  server.close();
}
