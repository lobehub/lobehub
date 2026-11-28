import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isFileParseBudgetError } from '@lobechat/file-loaders';
import { buildTestZip } from '@lobechat/file-loaders/src/loaders/excel/testUtils';
import { Workbook } from 'exceljs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ChunkingLoader } from '@/libs/document-loaders';

import { buildFileParseWorker } from '../../../../../scripts/buildFileParseWorker.mjs';
import { FILE_PARSE_WORKER_PATH_ENV } from './artifact';
import { FileParseError } from './errors';
import { chunkContentInWorker, getSharedFileParseRunner } from './index';
import { createFileParseRunner, DEFAULT_FILE_PARSE_LIMITS } from './runner';

// The real build artifact in real threads, on the chunking path of the knowledge base.
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

let dir: string;
let workerPath: string;
const previousEnv = process.env[FILE_PARSE_WORKER_PATH_ENV];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-chunk-'));
  workerPath = await buildFileParseWorker({ outdir: path.join(dir, 'artifact') });
  process.env[FILE_PARSE_WORKER_PATH_ENV] = workerPath;
}, 60_000);

afterAll(async () => {
  if (previousEnv === undefined) delete process.env[FILE_PARSE_WORKER_PATH_ENV];
  else process.env[FILE_PARSE_WORKER_PATH_ENV] = previousEnv;
  await rm(dir, { force: true, recursive: true });
});

const trackTimerProgress = () => {
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
  }, 20);
  return () => {
    clearInterval(interval);
    return ticks;
  };
};

const buildDenseWorkbook = async (rows: number) => {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Dense');
  sheet.addRow(['id', 'name', 'note', 'a', 'b', 'c', 'd', 'e']);
  for (let i = 0; i < rows; i++) {
    sheet.addRow([i, `name-${i}`, `note ${i} `.repeat(4), 1, 2, 3, 4, 5]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
};

describe('chunking in the parse worker', () => {
  it('extracts a legacy binary Word document before splitting it', async () => {
    const content = await readFile(
      here('../../../../../packages/file-loaders/src/loaders/doc/fixtures/test.doc'),
    );

    const chunks = await chunkContentInWorker('report.DOC', content);

    expect(chunks.map((chunk) => chunk.pageContent).join('\n')).toContain('简单报告');
  });

  it('keeps chunk content, row metadata and cell semantics identical to the in-process loader', async () => {
    const workbook = new Workbook();
    const pricing = workbook.addWorksheet('Pricing');
    pricing.addRow(['Plan', 'Discount']);
    pricing.addRow(['Basic', '10%']);
    pricing.addRow([]);
    pricing.addRow(['Pro', '20%']);
    const values = workbook.addWorksheet('Values');
    values.addRow(['Rich text', 'Formula', 'Date', 'Error']);
    values.addRow([
      { richText: [{ text: 'Hello ' }, { text: 'world' }] },
      { formula: '1+1', result: 2 },
      new Date('2026-10-07T00:00:00Z'),
      { error: '#DIV/0!' },
    ]);
    const content = new Uint8Array(await workbook.xlsx.writeBuffer());

    const inProcess = await new ChunkingLoader().partitionContent('book.xlsx', content);
    const inWorker = await chunkContentInWorker('book.xlsx', content);

    expect(inWorker).toEqual(inProcess);
    expect(inWorker.map((chunk) => chunk.metadata)).toEqual([
      { row: 2, sheetName: 'Pricing', source: 'blob' },
      { row: 4, sheetName: 'Pricing', source: 'blob' },
      { row: 2, sheetName: 'Values', source: 'blob' },
    ]);
    expect(inWorker[2].pageContent).toBe(
      'Rich text: Hello world\nFormula: 2\nDate: 2026-10-07\nError: #DIV/0!',
    );
  });

  it('chunks markdown and text through the same worker with the same output', async () => {
    const markdown = new TextEncoder().encode(`# Title\n\n${'paragraph text. '.repeat(400)}\n`);

    const inProcess = await new ChunkingLoader().partitionContent('doc.md', markdown);
    const inWorker = await chunkContentInWorker('doc.md', markdown);

    expect(inWorker.length).toBeGreaterThan(1);
    expect(inWorker).toEqual(inProcess);
  });

  it('keeps the request thread timers running while the splitter is busy', async () => {
    // One 16MB paragraph with no separator: the recursive splitter works through it
    // synchronously for about a second, which on the request thread stops every timer.
    const content = new TextEncoder().encode('abcdefghij'.repeat(1_600_000));
    const stop = trackTimerProgress();
    let ticks = 0;

    const chunks = await chunkContentInWorker('wall-of-text.md', content).finally(() => {
      ticks = stop();
    });

    expect(chunks.length).toBeGreaterThan(30_000);
    expect(ticks).toBeGreaterThan(0);
  }, 60_000);

  it('refuses a spreadsheet archive over the zip budget before exceljs sees it', async () => {
    // Declares a 300MiB worksheet but holds a few bytes: refused on the declaration alone.
    const bomb = buildTestZip([
      {
        data: '<worksheet/>',
        declaredSize: 300 * 1024 * 1024,
        deflate: true,
        name: 'xl/worksheets/sheet1.xml',
      },
    ]);

    const error = await chunkContentInWorker('bomb.xlsx', new Uint8Array(bomb)).catch((e) => e);

    expect(isFileParseBudgetError(error)).toBe(true);
    expect(error).toMatchObject({ reason: 'sheet-xml' });
  });

  it('stops an empty-styled-rows spreadsheet inside the worker and keeps the request thread alive', async () => {
    const part = (name: string, data: string) => ({ data, name });
    const rows = Array.from(
      { length: 800_000 },
      (_, i) => `<row r="${i + 1}" s="1" customFormat="1"><c r="A${i + 1}" s="1"/></row>`,
    ).join('');
    // Rows with a style and no value: a few bytes each in the file, an object each in exceljs.
    const content = new Uint8Array(
      buildTestZip([
        part(
          '[Content_Types].xml',
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        ),
        part(
          '_rels/.rels',
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        ),
        part(
          'xl/workbook.xml',
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
        ),
        part(
          'xl/_rels/workbook.xml.rels',
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        ),
        // exceljs resolves `s="1"` against the stylesheet: without one the parse fails on the first row
        // instead of building the row objects this test is about.
        part(
          'xl/styles.xml',
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"/></cellXfs></styleSheet>',
        ),
        {
          data: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
          deflate: true,
          name: 'xl/worksheets/sheet1.xml',
        },
      ]),
    );
    // The production heap limit: a heap this far below it (160MB) aborts the whole process on Node
    // 24.11.1 ("Reached heap limit" fatal error) instead of ending the thread with a typed error.
    const runner = createFileParseRunner({
      maxOldGenerationSizeMb: DEFAULT_FILE_PARSE_LIMITS.maxOldGenerationSizeMb,
      parseTimeoutMs: 20_000,
      workerPath: () => workerPath,
    });
    const stop = trackTimerProgress();
    let ticks = 0;

    const error = await runner
      .run({ content, filename: 'styled.xlsx', kind: 'chunk' })
      .finally(() => {
        ticks = stop();
      })
      .catch((e) => e);

    expect(ticks).toBeGreaterThan(0);
    expect(error).toBeInstanceOf(FileParseError);
    expect(['OUT_OF_MEMORY', 'TIMEOUT']).toContain(error.code);
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
    // the next job runs normally on a fresh thread
    await expect(
      runner.run({ content: new TextEncoder().encode('fine'), filename: 'a.txt', kind: 'chunk' }),
    ).resolves.toHaveLength(1);
  }, 60_000);

  it('reports a malformed spreadsheet as a failure and leaves the runner usable', async () => {
    const error = await chunkContentInWorker(
      'broken.xlsx',
      new TextEncoder().encode('not a zip'),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(FileParseError);
    expect(error).toMatchObject({ code: 'PARSE_FAILED' });
    expect(getSharedFileParseRunner().stats()).toEqual({ active: 0, queued: 0 });
    await expect(
      chunkContentInWorker('ok.txt', new TextEncoder().encode('still works')),
    ).resolves.toHaveLength(1);
  });

  it('reports a file no chunking loader handles as a failure, never as an empty success', async () => {
    const error = await chunkContentInWorker('x.qzx', new Uint8Array([1])).catch((e) => e);

    expect(error).toBeInstanceOf(FileParseError);
    expect(error.message).toContain('Unsupported file type');
  });

  it('terminates a worker that runs out of time, frees the slot and writes no result', async () => {
    const runner = createFileParseRunner({ parseTimeoutMs: 500, workerPath: () => workerPath });
    const content = await buildDenseWorkbook(40_000);

    const error = await runner
      .run({ content, filename: 'slow.xlsx', kind: 'chunk' })
      .catch((e) => e);

    expect(error).toMatchObject({ code: 'TIMEOUT', name: 'FileParseError' });
    // The promise only settled after the thread really exited: the slot is back already.
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
    // The next task takes the freed slot at once. Its own result is not asserted: on a loaded CI
    // runner a fresh worker can need more than this runner's 500ms just to start.
    const onStart = vi.fn();
    const next = runner
      .run(
        { content: new TextEncoder().encode('after'), filename: 'a.txt', kind: 'chunk' },
        { onStart },
      )
      .catch(() => undefined);
    expect(runner.stats()).toEqual({ active: 1, queued: 0 });
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    await next;
  }, 60_000);

  it('gives a chunk job its own scratch directory and removes it once the thread has exited', async () => {
    const scratchRoot = await mkdtemp(path.join(tmpdir(), 'file-parse-scratch-root-'));
    const previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = scratchRoot;
    try {
      const epub = new Uint8Array(
        await readFile(here('../../../../../packages/file-loaders/test/fixtures/test.epub')),
      );

      const done = createFileParseRunner({ workerPath: () => workerPath });
      const chunks = await done.run<unknown[]>({
        content: epub,
        filename: 'book.epub',
        kind: 'chunk',
      });
      expect(chunks.length).toBeGreaterThan(0);
      expect(await readdir(scratchRoot)).toEqual([]);

      // Killed in the middle of the epub: whatever the thread had written is gone with it.
      const killed = createFileParseRunner({ parseTimeoutMs: 1, workerPath: () => workerPath });
      const error = await killed
        .run({ content: epub, filename: 'book.epub', kind: 'chunk' })
        .catch((e) => e);
      expect(error).toMatchObject({ code: 'TIMEOUT' });
      expect(await readdir(scratchRoot)).toEqual([]);
    } finally {
      if (previousTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmp;
      await rm(scratchRoot, { force: true, recursive: true });
    }
  }, 60_000);
});
