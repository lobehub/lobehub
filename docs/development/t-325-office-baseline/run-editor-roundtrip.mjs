/**
 * T-325 round 4 — five-stage lifecycle driver against the production Office editors.
 *
 * Mounts the real src/features/FileViewer/Renderer/{PPTX,XLSX,DOCX} editors through the
 * running Vite dev server (bun run dev:spa, port 9876) and, for each document type, walks
 * import → edit → save → reopen (full page reload + remount, draft restored from
 * IndexedDB) → export/download, capturing a screenshot per stage and a machine log.
 *
 * Usage: node docs/development/t-325-office-baseline/run-editor-roundtrip.mjs
 * Output: artifacts/t-325-office-baseline/r4/
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  chromium,
} = require('../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright');

const root = path.resolve(import.meta.dirname, '../../..');
const outputDir = path.join(root, 'artifacts/t-325-office-baseline/r4');
await mkdir(outputDir, { recursive: true });

const BASE = 'http://localhost:9876';
const MARKER = 'T-325-R4';
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const cases = {
  docx: {
    fixture: 'packages/file-loaders/src/loaders/docx/fixtures/test.docx',
    renderer: '/src/features/FileViewer/Renderer/DOCX/index.tsx',
  },
  pptx: {
    fixture: 'packages/file-loaders/src/loaders/pptx/fixtures/test.pptx',
    renderer: '/src/features/FileViewer/Renderer/PPTX/index.tsx',
  },
  xlsx: {
    fixture: 'packages/file-loaders/src/loaders/excel/fixtures/test.xlsx',
    renderer: '/src/features/FileViewer/Renderer/XLSX/index.tsx',
  },
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { height: 960, width: 1440 },
});
const log = [];
const note = (key, stage, data) => {
  log.push({ data, key, stage, time: new Date().toISOString() });
  console.info(`[${key}] ${stage}:`, JSON.stringify(data).slice(0, 400));
};

/** Mount the production editor component on a blank page of the dev server. */
const mount = async (page, key, { resetDrafts = false } = {}) => {
  const item = cases[key];
  await page.goto(`${BASE}/`, { timeout: 120_000, waitUntil: 'domcontentloaded' });
  if (resetDrafts)
    await page.evaluate(
      () =>
        Promise.all(
          ['lobehub-pptx-editor', 'lobehub-xlsx-editor', 'lobehub-office-drafts'].map(
            (name) =>
              new Promise((resolve) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
              }),
          ),
        ),
    );
  await page.evaluate(
    async ({ fileId, fileName, rendererPath, url }) => {
      const [{ default: React }, { default: ReactDOMClient }, { default: Editor }, ui, motionReact] =
        await Promise.all([
          import('/node_modules/.vite/deps/react.js'),
          import('/node_modules/.vite/deps/react-dom_client.js'),
          import(rendererPath),
          import('/node_modules/.vite/deps/@lobehub_ui.js'),
          import('/node_modules/.vite/deps/motion_react.js'),
        ]);
      document.body.innerHTML =
        '<main style="height:900px;padding:16px"><header style="height:32px;font:600 16px sans-serif">T-325 R4 · ' +
        fileName +
        '</header><section id="editor" style="height:840px;border:1px solid #ccc"></section></main>';
      window.__t325Root = ReactDOMClient.createRoot(document.querySelector('#editor'));
      window.__t325Root.render(
        React.createElement(
          ui.MotionProvider,
          { motion: motionReact.motion },
          React.createElement(Editor, { fileId, fileName, url }),
        ),
      );
    },
    {
      fileId: `t325-r4-${key}`,
      fileName: path.basename(item.fixture),
      rendererPath: item.renderer,
      url: `/@fs/${path.join(root, item.fixture)}`,
    },
  );
};

/**
 * Click a toolbar control. Candidates are either `svg:<lucide-class>` (icon-only
 * ActionIcons render a lucide svg, tooltips are not DOM titles) or exact button text.
 */
const clickAction = async (page, candidates) => {
  const found = await page.evaluate((names) => {
    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    for (const name of names) {
      const target = name.startsWith('svg:')
        ? buttons.find((element) => element.querySelector(`svg.${name.slice(4)}`))
        : buttons.find((element) => element.textContent?.trim() === name);
      if (target) {
        target.click();
        return name;
      }
    }
    return null;
  }, candidates);
  if (!found) throw new Error(`No control matched: ${candidates.join(' | ')}`);
  await page.waitForTimeout(3500);
  return found;
};

const queuePrompts = (page, answers) =>
  page.evaluate((queue) => {
    window.__t325Prompts = [...queue];
    window.prompt = (message, fallback) =>
      window.__t325Prompts.length > 0 ? window.__t325Prompts.shift() : (fallback ?? null);
  }, answers);

const uiState = (page) =>
  page.evaluate(() => ({
    buttons: [...document.querySelectorAll('button')]
      .map((element) => element.getAttribute('title') || element.textContent?.trim() || '?')
      .slice(0, 40),
    statusTexts: [...document.querySelectorAll('span')]
      .map((element) => element.textContent?.trim())
      .filter((text) => text && /status|Saved|Unsaved|Saving|保存|未保存/.test(text)),
    text: document.querySelector('#editor')?.textContent?.trim().slice(0, 600) || '',
  }));

const shot = async (page, name) => {
  const file = path.join(outputDir, name);
  await page.screenshot({ fullPage: true, path: file });
  return path.relative(root, file);
};

const download = async (page, key, saveClick) => {
  const [downloadEvent] = await Promise.all([page.waitForEvent('download'), saveClick()]);
  const exportPath = path.join(outputDir, `export-${MARKER}-${key}.${key}`);
  await downloadEvent.saveAs(exportPath);
  const input = await readFile(path.join(root, cases[key].fixture));
  const output = await readFile(exportPath);
  return {
    exportPath: path.relative(root, exportPath),
    inputBytes: input.length,
    inputSha256: sha256(input),
    outputBytes: output.length,
    outputSha256: sha256(output),
    shaChanged: sha256(input) !== sha256(output),
  };
};

const statusCandidates = {
  saved: ['Saved', '已保存'],
  unsaved: ['Unsaved changes', '未保存的更改', '有未保存的更改'],
};
const waitStatus = async (page, kind, extraKeys = []) => {
  const names = [...statusCandidates[kind], ...extraKeys];
  await page.waitForFunction(
    (candidates) =>
      [...document.querySelectorAll('span')].some((element) =>
        candidates.includes(element.textContent?.trim() || ''),
      ),
    names,
    { timeout: 10_000 },
  );
};

/* ------------------------------------------------------------------ PPTX */
{
  const key = 'pptx';
  const page = await context.newPage();
  page.on('pageerror', (error) => note(key, 'pageerror', { message: error.message }));
  await mount(page, key, { resetDrafts: true });
  await page.waitForSelector('svg.lucide-undo-2', { timeout: 60_000 });
  await page.waitForTimeout(4000);
  note(key, '1-import', await uiState(page));
  note(key, '1-import-shot', { screenshot: await shot(page, 'pptx-1-import.png') });

  await queuePrompts(page, [`${MARKER}-PPT 新增文本`]);
  await clickAction(page, ['svg:lucide-type']);
  await clickAction(page, ['svg:lucide-box']);
  await queuePrompts(page, ['Q1,Q2,Q3', '120,150,180']);
  await clickAction(page, ['svg:lucide-chart-column']);
  await clickAction(page, ['svg:lucide-copy']);
  await page.waitForTimeout(3500);
  note(key, '2-edit', await uiState(page));
  note(key, '2-edit-nodes', await page.evaluate(() => ({
    ariaLabels: [...document.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')),
  })));
  note(key, '2-edit-shot', { screenshot: await shot(page, 'pptx-2-edited.png') });

  await clickAction(page, ['svg:lucide-undo-2']);
  await page.waitForTimeout(1500);
  note(key, '2-undo', await uiState(page));
  await clickAction(page, ['svg:lucide-redo-2']);
  await page.waitForTimeout(1500);
  note(key, '2-redo', await uiState(page));

  await clickAction(page, ['Save', '保存']);
  await waitStatus(page, 'saved', ['pptxEditor.status.saved']);
  note(key, '3-save', await uiState(page));
  note(key, '3-save-shot', { screenshot: await shot(page, 'pptx-3-saved.png') });

  await mount(page, key); // full page.goto + remount == close & reopen
  await page.waitForSelector('svg.lucide-undo-2', { timeout: 60_000 });
  await page.waitForTimeout(4000);
  note(key, '4-reopen', await uiState(page));
  note(key, '4-reopen-shot', { screenshot: await shot(page, 'pptx-4-reopened.png') });

  note(
    key,
    '5-export',
    await download(page, key, () =>
      clickAction(page, ['Download', '下载']),
    ),
  );
  await page.close();
}

/* ------------------------------------------------------------------ XLSX */
{
  const key = 'xlsx';
  const page = await context.newPage();
  page.on('pageerror', (error) => note(key, 'pageerror', { message: error.message }));
  await mount(page, key, { resetDrafts: true });
  await page.waitForSelector('td', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  note(key, '1-import', await uiState(page));
  note(key, '1-import-shot', { screenshot: await shot(page, 'xlsx-1-import.png') });

  // A1 is the default selection; type a marker through the formula bar.
  // Input 0 is the number-format Select's search box; input 1 is the formula bar.
  const formulaBar = page.locator('input').nth(1);
  await formulaBar.fill(`${MARKER} 数据`);
  await formulaBar.press('Enter');
  await page.waitForFunction(
    (marker) => document.querySelector('#editor')?.textContent?.includes(marker),
    `${MARKER} 数据`,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(1500);
  // Pick another cell and enter an arithmetic formula.
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll('td')];
    cells.at(-1)?.click(); // last visible cell of the grid
  });
  await page.waitForTimeout(1000);
  await formulaBar.fill('=2*3+4');
  await formulaBar.press('Enter');
  await page.waitForTimeout(4000);
  note(key, '2-formula-grid', await uiState(page));
  await clickAction(page, ['svg:lucide-bold']);
  await clickAction(page, ['svg:lucide-plus']);
  await page.waitForTimeout(800);
  note(key, '2-edit', await uiState(page));
  note(key, '2-edit-shot', { screenshot: await shot(page, 'xlsx-2-edited.png') });

  await clickAction(page, ['svg:lucide-undo-2']);
  await page.waitForTimeout(800);
  note(key, '2-undo', await uiState(page));
  await clickAction(page, ['svg:lucide-redo-2']);
  await page.waitForTimeout(800);
  note(key, '2-redo', await uiState(page));

  await clickAction(page, ['Save', '保存']);
  await waitStatus(page, 'saved', ['xlsxEditor.status.saved']);
  note(key, '3-save', await uiState(page));
  note(key, '3-save-shot', { screenshot: await shot(page, 'xlsx-3-saved.png') });

  await mount(page, key);
  await page.waitForSelector('td', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  note(key, '4-reopen', await uiState(page));
  note(key, '4-reopen-shot', { screenshot: await shot(page, 'xlsx-4-reopened.png') });

  note(
    key,
    '5-export',
    await download(page, key, () =>
      clickAction(page, ['Download', '下载']),
    ),
  );
  await page.close();
}

/* ------------------------------------------------------------------ DOCX */
{
  const key = 'docx';
  const page = await context.newPage();
  page.on('pageerror', (error) => note(key, 'pageerror', { message: error.message }));
  await mount(page, key, { resetDrafts: true });
  await page.waitForSelector('textarea', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  note(key, '1-import', await uiState(page));
  note(key, '1-import-shot', { screenshot: await shot(page, 'docx-1-import.png') });

  const firstParagraph = page.locator('textarea').first();
  await firstParagraph.click();
  await firstParagraph.fill(`${MARKER}-WORD 简单报告（已编辑）`);
  await page.keyboard.press('Tab'); // blur applies setParagraphText
  await page.waitForTimeout(3500);
  await page.locator('textarea').first().click(); // reselect paragraph 0
  await clickAction(page, ['svg:lucide-bold']);
  await page.selectOption('select', 'Heading1').catch(() => null);
  await page.waitForTimeout(3500);
  await clickAction(page, ['svg:lucide-list-ordered']);
  await clickAction(page, ['svg:lucide-table-2']);
  await page.waitForTimeout(1200);
  note(key, '2-edit', await uiState(page));
  note(key, '2-edit-shot', { screenshot: await shot(page, 'docx-2-edited.png') });

  await clickAction(page, ['svg:lucide-undo-2']);
  await page.waitForTimeout(800);
  note(key, '2-undo', await uiState(page));
  await clickAction(page, ['svg:lucide-redo-2']);
  await page.waitForTimeout(800);
  note(key, '2-redo', await uiState(page));

  await clickAction(page, ['Save', '保存']);
  await waitStatus(page, 'saved', ['docxEditor.status.saved']);
  note(key, '3-save', await uiState(page));
  note(key, '3-save-shot', { screenshot: await shot(page, 'docx-3-saved.png') });

  await mount(page, key);
  await page.waitForSelector('textarea', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  note(key, '4-reopen', await uiState(page));
  note(key, '4-reopen-shot', { screenshot: await shot(page, 'docx-4-reopened.png') });

  note(
    key,
    '5-export',
    await download(page, key, () =>
      clickAction(page, ['Download', '下载']),
    ),
  );
  await page.close();
}

await browser.close();
await writeFile(
  path.join(outputDir, 'editor-roundtrip-log.json'),
  `${JSON.stringify(log, null, 2)}\n`,
);
console.info(`\nDone. ${log.length} log entries → ${path.relative(root, outputDir)}`);
