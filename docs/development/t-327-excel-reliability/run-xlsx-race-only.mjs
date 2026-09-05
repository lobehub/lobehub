/**
 * T-327 round 6 — race-only A/B probe. Mounts the XLSX editor, fires the same
 * rapid-fire block as the full driver (4 ops, ~150ms apart), exports, and
 * reports which edits survived. Run once against the pre-fix editor and once
 * against the fixed one. Output dir comes from argv[2].
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  chromium,
} = require('../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright');
const ExcelJS = require('../../../node_modules/exceljs');

const root = path.resolve(import.meta.dirname, '../../..');
const outputDir = path.join(root, process.argv[2] || 'artifacts/t-327-excel-reliability/race-probe');
await mkdir(outputDir, { recursive: true });
const fixturePath = path.join(root, 'artifacts/t-327-excel-reliability/r6/fixture-multisheet.xlsx');
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { height: 960, width: 1440 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.info('[pageerror]', error.message));

await page.goto('http://localhost:9876/', { timeout: 120_000, waitUntil: 'domcontentloaded' });
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('lobehub-xlsx-editor');
      request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
    }),
);
await page.evaluate(
  async ({ url }) => {
    const [{ default: React }, { default: ReactDOMClient }, { default: Editor }, ui, motionReact] =
      await Promise.all([
        import('/node_modules/.vite/deps/react.js'),
        import('/node_modules/.vite/deps/react-dom_client.js'),
        import('/src/features/FileViewer/Renderer/XLSX/index.tsx'),
        import('/node_modules/.vite/deps/@lobehub_ui.js'),
        import('/node_modules/.vite/deps/motion_react.js'),
      ]);
    document.body.innerHTML = '<section id="editor" style="height:900px"></section>';
    ReactDOMClient.createRoot(document.querySelector('#editor')).render(
      React.createElement(
        ui.MotionProvider,
        { motion: motionReact.motion },
        React.createElement(Editor, { fileId: 't327-race-probe', fileName: 'race.xlsx', url }),
      ),
    );
  },
  { url: `/@fs/${fixturePath}` },
);
await page.waitForSelector('td', { timeout: 60_000 });
await page.waitForTimeout(1500);

// Rapid-fire block: value entry + bold + add sheet + italic, ~150ms apart.
await page.click('#editor tbody tr:nth-child(10) td:nth-child(2)');
await page.waitForTimeout(250);
const formulaBar = page.locator('#editor input').last();
await formulaBar.fill('RACE-A');
await formulaBar.press('Enter');
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector('#editor svg.lucide-bold')?.closest('button')?.click());
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector('#editor svg.lucide-plus')?.closest('button')?.click());
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector('#editor svg.lucide-italic')?.closest('button')?.click());
await page.waitForTimeout(5000);

const [downloadEvent] = await Promise.all([
  page.waitForEvent('download'),
  page.evaluate(() => {
    const button = [...document.querySelectorAll('#editor button')].find(
      (element) => element.textContent?.trim() === 'Download',
    );
    button?.click();
  }),
]);
const exportPath = path.join(outputDir, 'race-export.xlsx');
await downloadEvent.saveAs(exportPath);
await page.close();
await browser.close();

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(exportPath);
const a10 = wb.getWorksheet('Sales').getCell('A10');
const survived = {
  addSheet: wb.worksheets.some((sheet) => /^Sheet\d+$/.test(sheet.name) && sheet.name !== 'Sheet1'),
  bold: a10.font?.bold === true,
  italic: a10.font?.italic === true,
  sheets: wb.worksheets.map((sheet) => sheet.name),
  value: a10.value,
};
survived.allSurvived = survived.value === 'RACE-A' && survived.bold && survived.italic && survived.addSheet;
console.info('RACE RESULT:', JSON.stringify(survived));
await writeFile(
  path.join(outputDir, 'race-result.json'),
  `${JSON.stringify({ exportSha256: sha256(await readFile(exportPath)), survived }, null, 2)}\n`,
);
