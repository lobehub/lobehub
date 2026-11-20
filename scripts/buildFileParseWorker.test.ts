/**
 * @vitest-environment node
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFileParseRunner } from '../apps/server/src/services/fileParse/runner';
import { buildFileParseWorker } from './buildFileParseWorker.mts';

const loaders = (relative: string) =>
  path.resolve(__dirname, '../packages/file-loaders/src/loaders', relative);

// Built into a directory with no node_modules above it, the way the artifact is copied into an
// image: every parser (pdfjs and its worker, mammoth, xlsx, officeparser, word-extractor) has to
// be inside the one file.
let dir: string;
let workerPath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-build-'));
  workerPath = await buildFileParseWorker({ outdir: path.join(dir, 'dist/file-parse-worker') });
}, 60_000);

afterAll(() => rm(dir, { force: true, recursive: true }));

describe('buildFileParseWorker', () => {
  it('emits one self-contained file that imports nothing but Node built-ins', async () => {
    const source = await readFile(workerPath, 'utf8');
    const bare = [...source.matchAll(/^import [^'"\n]*?from\s*["']([^"']+)["']/gm)]
      .map((match) => match[1])
      .filter((specifier) => !specifier.startsWith('node:'));

    expect(bare).toEqual([]);
  });

  it.each([
    ['txt', 'text/fixtures/test.txt', 'text'],
    ['xlsx', 'excel/fixtures/test.xlsx', ''],
    ['docx', 'docx/fixtures/test.docx', ''],
    ['doc', 'doc/fixtures/test.doc', ''],
    ['pdf', 'pdf/fixtures/test.pdf', ''],
    ['pptx', 'pptx/fixtures/test.pptx', ''],
    ['ipynb', 'ipynb/fixtures/test.ipynb', ''],
  ])('parses a %s file with every dependency inside the artifact', async (_, fixture) => {
    const runner = createFileParseRunner({ workerPath: () => workerPath });

    const document = await runner.run<{ content: string; metadata: { error?: string } }>({
      filePath: loaders(fixture),
      kind: 'file',
      mode: 'file',
    });

    expect(document.content.trim().length).toBeGreaterThan(0);
    expect(document.metadata.error).toBeUndefined();
  });

  // The chunking job runs the knowledge-base loaders, which load their libraries lazily: each one
  // has to be inside the artifact and has to actually run there, not only be importable.
  it.each([
    ['txt', 'text/fixtures/test.txt', 'test.txt'],
    ['csv', 'text/fixtures/test-utf16le.csv', 'test.csv'],
    ['xlsx', 'excel/fixtures/test.xlsx', 'test.xlsx'],
    ['docx', 'docx/fixtures/test.docx', 'test.docx'],
    ['pdf', 'pdf/fixtures/test.pdf', 'test.pdf'],
    ['pptx', 'pptx/fixtures/test.pptx', 'test.pptx'],
    ['ipynb', 'ipynb/fixtures/test.ipynb', 'test.ipynb'],
    ['epub', '../../test/fixtures/test.epub', 'test.epub'],
  ])(
    'chunks a %s file with every loader dependency inside the artifact',
    async (_, fixture, filename) => {
      const scratch = await mkdtemp(path.join(tmpdir(), 'file-parse-chunk-scratch-'));
      const previousTmp = process.env.TMPDIR;
      process.env.TMPDIR = scratch;
      try {
        const runner = createFileParseRunner({ workerPath: () => workerPath });

        const chunks = await runner.run<Array<{ metadata: object; pageContent: string }>>({
          content: new Uint8Array(await readFile(loaders(fixture))),
          filename,
          kind: 'chunk',
        });

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.some((chunk) => chunk.pageContent.trim().length > 0)).toBe(true);
        // the epub loader's temp file is gone with the scratch directory
        expect(await readdir(scratch)).toEqual([]);
      } finally {
        if (previousTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previousTmp;
        await rm(scratch, { force: true, recursive: true });
      }
    },
  );
});
