/**
 * T-327 round 6 — Excel data-editing & calculation reliability driver.
 *
 * Mounts the production src/features/FileViewer/Renderer/XLSX editor through the
 * running Vite dev server (SPA_PORT=9876 bun run dev:spa) and walks the full
 * acceptance matrix on a self-built multi-sheet workbook:
 *   import → cell/region edits → copy/paste → row & column cycles → formulas
 *   (arithmetic, SUM, cross-sheet) → number format & styles → sheet
 *   add/rename/reorder → undo/redo → rapid-fire race block → save → reopen
 *   (full reload + remount, draft from IndexedDB) → export/download.
 *
 * Usage: node docs/development/t-327-excel-reliability/run-xlsx-reliability.mjs
 * Output: artifacts/t-327-excel-reliability/r6/
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
const outputDir = path.join(root, 'artifacts/t-327-excel-reliability/r6');
await mkdir(outputDir, { recursive: true });

const BASE = 'http://localhost:9876';
const MARKER = 'T-327-R6';
const FILE_ID = 't327-r6-xlsx';
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/* ---------------------------------------------------------------- fixture */
const fixturePath = path.join(outputDir, 'fixture-multisheet.xlsx');
{
  const workbook = new ExcelJS.Workbook();
  const sales = workbook.addWorksheet('Sales');
  sales.addRows([
    ['Item', 'Qty', 'Price', 'Total'],
    ['Alpha', 2, 10, { formula: 'B2*C2', result: 20 }],
    ['Beta', 3, 5, { formula: 'B3*C3', result: 15 }],
    ['Grand total', null, null, { formula: 'SUM(D2:D3)', result: 35 }],
  ]);
  sales.getRow(1).font = { bold: true };
  const assumptions = workbook.addWorksheet('Assumptions');
  assumptions.addRows([['Tax rate', 0.1]]);
  await workbook.xlsx.writeFile(fixturePath);
}
const fixtureBytes = await readFile(fixturePath);
console.info('fixture:', path.relative(root, fixturePath), sha256(fixtureBytes));

/* ---------------------------------------------------------------- helpers */
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { height: 960, width: 1440 },
});
const log = [];
const note = (stage, data) => {
  log.push({ data, stage, time: new Date().toISOString() });
  console.info(`[xlsx] ${stage}:`, JSON.stringify(data).slice(0, 500));
};

const mount = async (page, { resetDrafts = false } = {}) => {
  await page.goto(`${BASE}/`, { timeout: 120_000, waitUntil: 'domcontentloaded' });
  if (resetDrafts)
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.deleteDatabase('lobehub-xlsx-editor');
          request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
        }),
    );
  await page.evaluate(
    async ({ fileId, fileName, url }) => {
      const [{ default: React }, { default: ReactDOMClient }, { default: Editor }, ui, motionReact] =
        await Promise.all([
          import('/node_modules/.vite/deps/react.js'),
          import('/node_modules/.vite/deps/react-dom_client.js'),
          import('/src/features/FileViewer/Renderer/XLSX/index.tsx'),
          import('/node_modules/.vite/deps/@lobehub_ui.js'),
          import('/node_modules/.vite/deps/motion_react.js'),
        ]);
      document.body.innerHTML =
        '<main style="height:920px;padding:12px"><header style="height:28px;font:600 15px sans-serif">T-327 R6 · ' +
        fileName +
        '</header><section id="editor" style="height:860px;border:1px solid #ccc"></section></main>';
      window.__t327Root = ReactDOMClient.createRoot(document.querySelector('#editor'));
      window.__t327Root.render(
        React.createElement(
          ui.MotionProvider,
          { motion: motionReact.motion },
          React.createElement(Editor, { fileId, fileName, url }),
        ),
      );
    },
    { fileId: FILE_ID, fileName: 'fixture-multisheet.xlsx', url: `/@fs/${fixturePath}` },
  );
  await page.waitForSelector('td', { timeout: 60_000 });
  await page.waitForTimeout(1200);
};

/** Click the grid cell at a 1-based row/column. */
const clickCell = async (page, row, column) => {
  await page.click(`#editor tbody tr:nth-child(${row}) td:nth-child(${column + 1})`);
  await page.waitForTimeout(250);
};

const formulaBar = (page) => page.locator('#editor input').last();

/** Select a cell and commit a value through the formula bar, waiting for the grid. */
const enterValue = async (page, row, column, value, expectText) => {
  await clickCell(page, row, column);
  await formulaBar(page).fill(value);
  await formulaBar(page).press('Enter');
  if (expectText)
    await page.waitForFunction(
      (needle) => document.querySelector('#editor')?.textContent?.includes(needle),
      expectText,
      { timeout: 15_000 },
    );
  await page.waitForTimeout(700);
};

const clickIcon = async (page, iconClass, settle = 900) => {
  const found = await page.evaluate((cls) => {
    const button = document.querySelector(`#editor svg.${cls}`)?.closest('button');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, iconClass);
  if (!found) throw new Error(`No enabled toolbar button renders svg.${iconClass}`);
  await page.waitForTimeout(settle);
};

const clickButtonText = async (page, text, settle = 900) => {
  const found = await page.evaluate((label) => {
    const button = [...document.querySelectorAll('#editor button')].find(
      (element) => element.textContent?.trim() === label,
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, text);
  if (!found) throw new Error(`No enabled button with text "${text}"`);
  await page.waitForTimeout(settle);
};

const gridState = (page) =>
  page.evaluate(() => {
    const table = document.querySelector('#editor table');
    const rows = [...(table?.querySelectorAll('tbody tr') || [])].slice(0, 12).map((row) =>
      [...row.querySelectorAll('td')].slice(0, 6).map((cell) => cell.textContent?.trim() || ''),
    );
    return {
      sheetTabs: [...document.querySelectorAll('#editor [data-active]')].map((tab) => ({
        active: tab.dataset.active === 'true',
        name: tab.textContent?.trim(),
      })),
      statusTexts: [...document.querySelectorAll('#editor span')]
        .map((element) => element.textContent?.trim())
        .filter((text) => text && /Saved|Unsaved|保存/.test(text)),
      topRows: rows,
    };
  });

const shot = async (page, name) => {
  const file = path.join(outputDir, name);
  await page.screenshot({ fullPage: true, path: file });
  return path.relative(root, file);
};

/* ------------------------------------------------------------------- run */
const page = await context.newPage();
page.on('pageerror', (error) => note('pageerror', { message: error.message }));

await mount(page, { resetDrafts: true });
note('1-import', await gridState(page));
note('1-import-shot', { screenshot: await shot(page, 'xlsx-r6-1-import.png') });

// -- Cell edits: change existing data, watch dependent formulas recalculate.
await enterValue(page, 2, 2, '4'); // B2: Qty 2 -> 4, D2 = B2*C2 must become 40
await page.waitForFunction(
  () => document.querySelector('#editor')?.textContent?.includes('40'),
  undefined,
  { timeout: 15_000 },
);
note('2-recalc-after-b2', await gridState(page));

// -- Row insert + fill a new data row (Gamma) inside the SUM range.
await clickCell(page, 3, 1); // anchor on the Beta row
await clickButtonText(page, 'Insert row', 1500);
await enterValue(page, 3, 1, 'Gamma', 'Gamma');
await enterValue(page, 3, 2, '1');
await enterValue(page, 3, 3, '8');
await enterValue(page, 3, 4, '=B3*C3');
note('3-inserted-row', await gridState(page));

// -- Formula suite on row 6: arithmetic, SUM, cross-sheet.
await enterValue(page, 6, 1, `${MARKER} 数据`, `${MARKER} 数据`);
await enterValue(page, 6, 2, '=2*3+4');
await enterValue(page, 6, 3, '=SUM(B2:B3)');
await enterValue(page, 6, 4, '=Assumptions!B1*200');
note('4-formulas', await gridState(page));

// -- Copy/paste the marker cell to A8.
await clickCell(page, 6, 1);
await clickIcon(page, 'lucide-copy', 300);
await clickCell(page, 8, 1);
await clickIcon(page, 'lucide-clipboard-paste', 1200);
note('5-paste', await gridState(page));

// -- Clear a scratch cell (delete data).
await enterValue(page, 2, 5, 'temp-to-clear', 'temp-to-clear');
await clickCell(page, 2, 5);
await clickIcon(page, 'lucide-eraser', 1200);
note('6-clear', {
  cleared: await page.evaluate(
    () => !document.querySelector('#editor')?.textContent?.includes('temp-to-clear'),
  ),
});

// -- Column insert/delete cycle at column C; totals must survive unshifted.
await clickCell(page, 2, 3);
await clickButtonText(page, 'Insert column', 1500);
note('7-column-inserted', await gridState(page));
await clickCell(page, 2, 3);
await clickButtonText(page, 'Delete column', 1500);
note('7-column-cycle-done', await gridState(page));

// -- Styles: bold + center the marker, currency format on D3.
await clickCell(page, 6, 1);
await clickIcon(page, 'lucide-bold');
await clickIcon(page, 'lucide-text-align-center');
await clickCell(page, 3, 4);
const formatOpened = await page
  .evaluate(() => {
    const trigger = [...document.querySelectorAll('#editor [role="combobox"], #editor button')].find(
      (element) => element.textContent?.trim() === 'Format' || element.role === 'combobox',
    );
    if (!trigger) return false;
    trigger.click();
    return true;
  })
  .catch(() => false);
if (formatOpened) {
  await page.waitForTimeout(600);
  const picked = await page.evaluate(() => {
    const option = [...document.querySelectorAll('[role="option"], [role="listbox"] *')].find(
      (element) => element.textContent?.trim() === 'Currency',
    );
    if (!option) return false;
    option.click();
    return true;
  });
  note('8-number-format', { opened: true, picked });
  await page.waitForTimeout(1500);
} else {
  note('8-number-format', { opened: false });
}
note('8-styles', await gridState(page));

// -- Worksheets: add, rename (prompt), reorder; then undo/redo the move.
await page.evaluate(() => {
  window.prompt = () => 'Summary';
});
await clickIcon(page, 'lucide-plus', 1500); // add -> Sheet3
await page.dblclick('#editor [data-active] >> nth=2').catch(() => null);
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('#editor [data-active]')];
  const sheet3 = tabs.find((tab) => tab.textContent?.trim() === 'Sheet3');
  sheet3?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('#editor [data-active]')];
  tabs.find((tab) => tab.textContent?.trim() === 'Summary')?.click();
});
await page.waitForTimeout(400);
await clickIcon(page, 'lucide-chevron-left', 1500); // move Summary before Assumptions
note('9-sheets', await gridState(page));

await clickIcon(page, 'lucide-undo-2', 1200);
note('9-undo', await gridState(page));
await clickIcon(page, 'lucide-redo-2', 1200);
note('9-redo', await gridState(page));

// -- Race block: rapid consecutive operations, ~150ms apart (each edit takes
//    far longer). Every one of them must survive into the draft and export.
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('#editor [data-active]')];
  tabs.find((tab) => tab.textContent?.trim() === 'Sales')?.click();
});
await page.waitForTimeout(500);
await clickCell(page, 10, 1);
await formulaBar(page).fill('RACE-A');
await formulaBar(page).press('Enter');
await page.waitForTimeout(150);
await page.evaluate(() => {
  document.querySelector('#editor svg.lucide-bold')?.closest('button')?.click();
});
await page.waitForTimeout(150);
await page.evaluate(() => {
  document.querySelector('#editor svg.lucide-plus')?.closest('button')?.click();
});
await page.waitForTimeout(150);
await page.evaluate(() => {
  document.querySelector('#editor svg.lucide-italic')?.closest('button')?.click();
});
await page.waitForTimeout(4000);
note('10-race', await gridState(page));
note('10-race-shot', { screenshot: await shot(page, 'xlsx-r6-2-edited.png') });

// -- Save.
await clickButtonText(page, 'Save', 800);
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('#editor span')].some(
      (element) => element.textContent?.trim() === 'Saved',
    ),
  undefined,
  { timeout: 10_000 },
);
note('11-save', await gridState(page));
note('11-save-shot', { screenshot: await shot(page, 'xlsx-r6-3-saved.png') });

// -- Reopen: full reload + remount, draft restored from IndexedDB.
await mount(page);
note('12-reopen', await gridState(page));
// Formula must round-trip in the formula bar (raw formula, not display text).
await clickCell(page, 6, 2);
note('12-reopen-formula-bar', { b6: await formulaBar(page).inputValue() });
note('12-reopen-shot', { screenshot: await shot(page, 'xlsx-r6-4-reopened.png') });

// -- Export.
const [downloadEvent] = await Promise.all([
  page.waitForEvent('download'),
  clickButtonText(page, 'Download', 400),
]);
const exportPath = path.join(outputDir, `export-${MARKER}.xlsx`);
await downloadEvent.saveAs(exportPath);
const output = await readFile(exportPath);
note('13-export', {
  exportPath: path.relative(root, exportPath),
  inputBytes: fixtureBytes.length,
  inputSha256: sha256(fixtureBytes),
  outputBytes: output.length,
  outputSha256: sha256(output),
  shaChanged: sha256(fixtureBytes) !== sha256(output),
});

await page.close();
await browser.close();
await writeFile(path.join(outputDir, 'xlsx-reliability-log.json'), `${JSON.stringify(log, null, 2)}\n`);
console.info(`\nDone. ${log.length} log entries → ${path.relative(root, outputDir)}`);
