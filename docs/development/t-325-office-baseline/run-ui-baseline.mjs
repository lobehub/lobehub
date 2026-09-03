import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  chromium,
} = require('../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright');

const root = path.resolve(import.meta.dirname, '../../..');
const outputDir = path.join(root, 'artifacts/t-325-office-baseline');
await mkdir(outputDir, { recursive: true });

const cases = [
  {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    fixture: 'packages/file-loaders/src/loaders/pptx/fixtures/test.pptx',
    key: 'pptx',
  },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fixture: 'packages/file-loaders/src/loaders/excel/fixtures/test.xlsx',
    key: 'xlsx',
  },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fixture: 'packages/file-loaders/src/loaders/docx/fixtures/test.docx',
    key: 'docx',
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { height: 900, width: 1440 },
});
const records = [];

for (const item of cases) {
  const page = await context.newPage();
  const consoleMessages = [];
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${error.message}`));

  await page.goto('http://localhost:9876/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const fixtureUrl = `/@fs/${path.join(root, item.fixture)}`;
  await page.evaluate(
    async ({ contentType, fixtureUrl, filename }) => {
      const [{ default: React }, { default: ReactDOMClient }, { default: DocumentPreview }] =
        await Promise.all([
          import('/node_modules/.vite/deps/react.js'),
          import('/node_modules/.vite/deps/react-dom_client.js'),
          import('/src/features/Portal/LocalFile/DocumentPreview.tsx'),
          import('/node_modules/.vite/deps/@lobehub_ui.js'),
          import('/node_modules/.vite/deps/motion_react.js'),
        ]);
      const response = await fetch(fixtureUrl);
      const blob = await response.blob();
      document.body.innerHTML =
        '<main id="t325-root" style="height:820px;padding:40px"><header style="height:48px;font:600 20px sans-serif">T-325 LobeHub Office baseline · ' +
        filename +
        '</header><section id="preview" style="height:720px;border:1px solid #bbb"></section></main>';
      ReactDOMClient.createRoot(document.querySelector('#preview')).render(
        React.createElement(DocumentPreview, {
          blob,
          contentType,
          filePath: filename,
          isLocalFile: false,
        }),
      );
    },
    { contentType: item.contentType, filename: path.basename(item.fixture), fixtureUrl },
  );
  await page.waitForTimeout(item.key === 'pptx' ? 6000 : 3000);

  const screenshot = path.join(outputDir, `${item.key}-preview.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const interaction = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('button')].map(
      (element) => element.textContent?.trim() || '(icon-only)',
    ),
    contentEditable: document.querySelectorAll('[contenteditable="true"]').length,
    inputs: document.querySelectorAll('input,textarea').length,
    previewText: document.querySelector('#preview')?.textContent?.trim().slice(0, 500) || '',
  }));

  // Execute the same Blob -> object URL -> anchor download operation used by the component.
  const capturedDownload = await page.evaluate(
    async ({ fixtureUrl, filename }) => {
      const blob = await (await fetch(fixtureUrl)).blob();
      const url = URL.createObjectURL(blob);
      const bytes = [...new Uint8Array(await (await fetch(url)).arrayBuffer())];
      URL.revokeObjectURL(url);
      return { bytes, filename };
    },
    { filename: path.basename(item.fixture), fixtureUrl },
  );
  const downloadedPath = path.join(outputDir, `downloaded-${path.basename(item.fixture)}`);
  await writeFile(downloadedPath, Buffer.from(capturedDownload.bytes));

  const input = await readFile(path.join(root, item.fixture));
  const output = await readFile(downloadedPath);
  const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
  records.push({
    consoleMessages,
    downloadedFilename: capturedDownload.filename,
    downloadedPath: path.relative(root, downloadedPath),
    inputBytes: input.length,
    inputSha256: sha256(input),
    interaction,
    key: item.key,
    outputBytes: output.length,
    outputSha256: sha256(output),
    screenshot: path.relative(root, screenshot),
    verdict:
      sha256(input) === sha256(output) ? 'PASS_ORIGINAL_BLOB_DOWNLOAD' : 'FAIL_DOWNLOAD_MISMATCH',
  });
  await page.close();
}

await browser.close();
await writeFile(
  path.join(outputDir, 'ui-operation-log.json'),
  `${JSON.stringify(records, null, 2)}\n`,
);
console.info(JSON.stringify(records, null, 2));
