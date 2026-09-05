/**
 * T-339 — full Word editing battery against the production DOCX editor.
 *
 * Mounts src/features/FileViewer/Renderer/DOCX through the running Vite dev
 * server and walks the complete contract: text add/edit/delete, copy/paste,
 * heading + paragraph styles, font family/size, alignment, bold, list toggles,
 * table edits, hyperlink add, image insert + replace, undo/redo, save,
 * reopen (page reload, draft restored from IndexedDB), and export/download.
 *
 * Usage:
 *   SPA_PORT=9911 bun run dev:spa   (in the worktree, separately)
 *   node docs/development/t-339-word/run-word-roundtrip.mjs
 * Output: artifacts/t-339-word/r1/
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// The main checkout's playwright matches the browser builds already cached
// under ~/Library/Caches/ms-playwright; the worktree's newer copy does not.
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    path.join(
      path.resolve(import.meta.dirname, '../../..'),
      'node_modules/.pnpm/playwright@1.63.0/node_modules/playwright',
    ),
);

const root = path.resolve(import.meta.dirname, '../../..');
const outputDir = path.resolve(root, process.env.OFFICE_EVIDENCE_DIR || 'artifacts/t-339-word/r1');
await mkdir(outputDir, { recursive: true });

const BASE = process.env.OFFICE_BASE_URL || 'http://localhost:9911';
const FIXTURE = 'docs/development/t-339-word/fixtures/t339-word-fixture.docx';
const RENDERER = '/src/features/FileViewer/Renderer/DOCX/index.tsx';
const WAIT = Number(process.env.OFFICE_ACTION_WAIT_MS || 2500);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const log = [];
const note = (stage, data) => {
  log.push({ data, stage, time: new Date().toISOString() });
  console.info(`[t339] ${stage}:`, JSON.stringify(data).slice(0, 500));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  permissions: ['clipboard-read', 'clipboard-write'],
  viewport: { height: 1200, width: 1440 },
});
const page = await context.newPage();
page.on('pageerror', (error) => note('pageerror', { message: error.message }));

const mount = async ({ resetDrafts = false } = {}) => {
  await page.goto(`${BASE}/`, { timeout: 120_000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  if (resetDrafts)
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.deleteDatabase('lobehub-office-drafts');
          request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
        }),
    );
  await page.evaluate(
    async ({ rendererPath, url }) => {
      const [{ default: React }, { default: ReactDOMClient }, { default: Editor }, ui, motionReact] =
        await Promise.all([
          import('/node_modules/.vite/deps/react.js'),
          import('/node_modules/.vite/deps/react-dom_client.js'),
          import(rendererPath),
          import('/node_modules/.vite/deps/@lobehub_ui.js'),
          import('/node_modules/.vite/deps/motion_react.js'),
        ]);
      document.body.innerHTML =
        '<main style="height:1100px;padding:16px"><header style="height:32px;font:600 16px sans-serif">T-339 · t339-word-fixture.docx</header><section id="editor" style="height:1040px;border:1px solid #ccc"></section></main>';
      window.__t339Root = ReactDOMClient.createRoot(document.querySelector('#editor'));
      window.__t339Root.render(
        React.createElement(
          ui.MotionProvider,
          { motion: motionReact.motion },
          React.createElement(Editor, {
            fileId: 't339-word',
            fileName: 't339-word-fixture.docx',
            url,
          }),
        ),
      );
    },
    { rendererPath: RENDERER, url: `/@fs/${path.join(root, FIXTURE)}` },
  );
  await page.waitForSelector('svg.lucide-undo-2', { timeout: 60_000 });
  await page.waitForTimeout(3000);
};

const clickIcon = async (lucideClass) => {
  const found = await page.evaluate((cls) => {
    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    const target = buttons.find((element) => element.querySelector(`svg.${cls}`));
    if (target) target.click();
    return Boolean(target);
  }, lucideClass);
  if (!found) throw new Error(`No toolbar control with svg.${lucideClass}`);
  await page.waitForTimeout(WAIT);
};

const clickText = async (text) => {
  const found = await page.evaluate((names) => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((element) => names.includes(element.textContent?.trim()));
    if (target) target.click();
    return Boolean(target);
  }, text);
  if (!found) throw new Error(`No button labeled ${text.join('|')}`);
  await page.waitForTimeout(WAIT);
};

/** Click the paragraph block whose textarea contains `needle` (selects it). */
const selectParagraph = async (needle) => {
  const ok = await page.evaluate((text) => {
    const blocks = [...document.querySelectorAll('[data-block-kind="paragraph"]')];
    const target = blocks.find((block) => block.querySelector('textarea')?.value.includes(text));
    if (target) target.click();
    return Boolean(target);
  }, needle);
  if (!ok) throw new Error(`No paragraph containing: ${needle}`);
  await page.waitForTimeout(400);
};

const setParagraphText = async (needle, nextText) => {
  await selectParagraph(needle);
  await page.evaluate(
    ({ needle: n, next }) => {
      const blocks = [...document.querySelectorAll('[data-block-kind="paragraph"]')];
      const textarea = blocks
        .map((block) => block.querySelector('textarea'))
        .find((element) => element?.value.includes(n));
      if (!textarea) throw new Error('textarea not found');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      ).set;
      setter.call(textarea, next);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      // React maps onBlur to the bubbling focusout event, not blur.
      textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    },
    { needle, next: nextText },
  );
  await page.waitForTimeout(WAIT);
};

const setSelect = async (index, value) => {
  await page.evaluate(
    ({ index: i, value: v }) => {
      const select = [...document.querySelectorAll('#editor select')][i];
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, v);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { index, value },
  );
  await page.waitForTimeout(WAIT);
};

const queuePrompts = (answers) =>
  page.evaluate((queue) => {
    window.__t339Prompts = [...queue];
    window.prompt = (message, fallback) =>
      window.__t339Prompts.length > 0 ? window.__t339Prompts.shift() : (fallback ?? null);
  }, answers);

const snapshot = () =>
  page.evaluate(() => ({
    images: [...document.querySelectorAll('#editor img')].length,
    listItems: [...document.querySelectorAll('[data-block-kind="paragraph"]')]
      .filter((block) =>
        [...block.querySelectorAll('span')].some((span) =>
          ['•', '1.'].includes(span.textContent?.trim() || ''),
        ),
      )
      .map((block) => block.querySelector('textarea')?.value),
    paragraphs: [...document.querySelectorAll('[data-block-kind="paragraph"] textarea')].map(
      (element) => element.value,
    ),
    status:
      [...document.querySelectorAll('#editor span')]
        .map((element) => element.textContent?.trim())
        .find((text) => /Saved|Unsaved|Saving|failed|保存/.test(text || '')) || '',
    tables: [...document.querySelectorAll('[data-block-kind="table"]')].map(
      (element) => element.textContent,
    ),
  }));

const shot = async (name) => {
  const file = path.join(outputDir, name);
  await page.screenshot({ fullPage: true, path: file });
  return path.relative(root, file);
};

const waitStatus = (kinds) =>
  page.waitForFunction(
    (candidates) =>
      [...document.querySelectorAll('#editor span')].some((element) =>
        candidates.includes(element.textContent?.trim() || ''),
      ),
    kinds,
    { timeout: 15_000 },
  );

const chooseFile = async (trigger, filePath) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(filePath);
  await page.waitForTimeout(WAIT);
};

/* ------------------------------------------------------------------ stage 1: import */
await mount({ resetDrafts: true });
note('1-import', await snapshot());
note('1-import-shot', { screenshot: await shot('docx-1-import.png') });

/* ------------------------------------------------------------------ stage 2: edit battery */
// a. text edit incl. multi-line (w:br path)
await setParagraphText('T339-BODY-ORIGINAL', 'T339-BODY-EDITED line-A\nT339-BODY-EDITED line-B');
// b. copy → paste (system clipboard)
await selectParagraph('T339-CJK');
await clickIcon('lucide-copy');
await clickIcon('lucide-clipboard-paste');
// c. re-style pasted copy: heading style demotion target instead: style the
//    "Reference material follows." paragraph as Heading3 via the style select.
await selectParagraph('Reference material follows.');
await setSelect(2, 'Heading3');
// d. font family + size on the CJK paragraph
await selectParagraph('T339-CJK');
await setSelect(0, 'Georgia');
await setSelect(1, '14');
// e. alignment: center the title, justify the edited body paragraph
await selectParagraph('Word fidelity fixture');
await clickIcon('lucide-text-align-center');
await selectParagraph('T339-BODY-EDITED line-A');
await clickIcon('lucide-text-align-justify');
// f. bold toggle on the closing sentinel
await selectParagraph('T339-DOC-END');
await clickIcon('lucide-bold');
// g. list toggles: pasted CJK copy → bullet; add paragraph → numbered
const beforeLists = await snapshot();
const pastedIndex = beforeLists.paragraphs.filter((text) => text.includes('T339-CJK')).length;
note('2-list-pre', { cjkCopies: pastedIndex });
// the pasted copy is the LAST paragraph containing T339-CJK
await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('[data-block-kind="paragraph"]')].filter((block) =>
    block.querySelector('textarea')?.value.includes('T339-CJK'),
  );
  blocks.at(-1)?.click();
});
await page.waitForTimeout(400);
await clickIcon('lucide-list');
await clickIcon('lucide-plus');
await selectParagraph('New paragraph');
await setParagraphText('New paragraph', 'T339-NUMBERED-ITEM');
await selectParagraph('T339-NUMBERED-ITEM');
await clickIcon('lucide-list-ordered');
// h. table cell edit: click table once to select, again to edit cells
await queuePrompts(['3', '3', 'Ready T339']);
await page.evaluate(() => document.querySelector('[data-block-kind="table"]')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-block-kind="table"]')?.click());
await page.waitForTimeout(WAIT);
// i. append a fresh 3x3 table
await clickIcon('lucide-table-2');
// j. hyperlink
await queuePrompts(['https://lobehub.com', 'LobeHub site']);
await clickIcon('lucide-link');
// k. insert image (new PNG via file chooser)
const insertPng = path.join(outputDir, 'insert-image.png');
{
  // solid red 64x48 PNG built by the fixture generator's algorithm, inline here
  const { crc32, deflateSync } = await import('node:zlib');
  const width = 64;
  const height = 48;
  const row = Buffer.alloc(1 + width * 3);
  for (let i = 0; i < width; i++) {
    row[1 + i * 3] = 224;
    row[2 + i * 3] = 49;
    row[3 + i * 3] = 49;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (kind, payload) => {
    const body = Buffer.concat([Buffer.from(kind), payload]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(insertPng, png);
}
await selectParagraph('T339-DOC-END');
await chooseFile(() => clickIcon('lucide-image-plus'), insertPng);
// l. replace the ORIGINAL fixture image (first img) with the red PNG too
await chooseFile(
  () => page.evaluate(() => document.querySelector('#editor img')?.click()),
  insertPng,
);
// m. delete: add a throwaway paragraph, then delete it
await clickIcon('lucide-plus');
await setParagraphText('New paragraph', 'T339-DELETE-ME');
await selectParagraph('T339-DELETE-ME');
await clickIcon('lucide-trash');
// n. undo (deleted paragraph returns) → redo (deleted again)
await clickIcon('lucide-undo-2');
const afterUndo = await snapshot();
note('2-undo', {
  deletedParagraphRestored: afterUndo.paragraphs.some((text) => text.includes('T339-DELETE-ME')),
});
await clickIcon('lucide-redo-2');
const afterRedo = await snapshot();
note('2-redo', {
  deletedParagraphGone: !afterRedo.paragraphs.some((text) => text.includes('T339-DELETE-ME')),
});

note('2-edited', await snapshot());
note('2-edited-shot', { screenshot: await shot('docx-2-edited.png') });

/* ------------------------------------------------------------------ stage 3: save */
await clickText(['Save', '保存']);
await waitStatus(['Saved', '已保存']);
note('3-saved', await snapshot());
note('3-saved-shot', { screenshot: await shot('docx-3-saved.png') });

/* ------------------------------------------------------------------ stage 4: reopen */
await mount({ resetDrafts: false });
const reopened = await snapshot();
note('4-reopened', reopened);
note('4-reopened-checks', {
  bulletOnPastedCjk: reopened.listItems.some((text) => text?.includes('T339-CJK')),
  numberedListMarked: reopened.listItems.some((text) => text?.includes('T339-NUMBERED-ITEM')),
  editedBodyPresent: reopened.paragraphs.some((text) => text.includes('T339-BODY-EDITED line-A')),
  imageCount: reopened.images,
  multilinePreserved: reopened.paragraphs.some((text) =>
    text.includes('T339-BODY-EDITED line-A\nT339-BODY-EDITED line-B'),
  ),
  numberedItemPresent: reopened.paragraphs.some((text) => text.includes('T339-NUMBERED-ITEM')),
  tableCellEdited: reopened.tables.some((text) => text.includes('Ready T339')),
  throwawayStillDeleted: !reopened.paragraphs.some((text) => text.includes('T339-DELETE-ME')),
});
note('4-reopened-shot', { screenshot: await shot('docx-4-reopened.png') });

/* ------------------------------------------------------------------ stage 5: export */
const [downloadEvent] = await Promise.all([
  page.waitForEvent('download'),
  clickText(['Download', '下载']),
]);
const exportPath = path.join(outputDir, 'export-t339-word.docx');
await downloadEvent.saveAs(exportPath);
const input = await readFile(path.join(root, FIXTURE));
const output = await readFile(exportPath);
note('5-export', {
  exportPath: path.relative(root, exportPath),
  inputBytes: input.length,
  inputSha256: sha256(input),
  outputBytes: output.length,
  outputSha256: sha256(output),
  shaChanged: sha256(input) !== sha256(output),
});

await writeFile(path.join(outputDir, 'word-roundtrip-log.json'), JSON.stringify(log, null, 2));
await browser.close();
console.info('done →', outputDir);
