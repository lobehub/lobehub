/**
 * Builds the file-parse worker (`apps/server/src/services/fileParse/worker.ts`) into one
 * self-contained ESM file: `dist/file-parse-worker/fileParseWorker.mjs`.
 *
 * Every parser (pdfjs and its fake worker, mammoth, xlsx, officeparser, word-extractor, papaparse)
 * is inlined, so the artifact needs no `node_modules` next to it and travels by plain file copy:
 * Next standalone (`outputFileTracingIncludes`), the web image and the channel worker image.
 *
 *   bun run build:file-parse-worker            # build + smoke check
 *   FILE_PARSE_WORKER_PATH=/app/.../fileParseWorker.mjs   # where a deployment keeps it
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(appRoot, 'package.json'));

const FILE_PARSE_WORKER_ENTRY = 'apps/server/src/services/fileParse/worker.ts';
const FILE_PARSE_WORKER_OUTDIR = path.join(appRoot, 'dist/file-parse-worker');
const FILE_PARSE_WORKER_FILENAME = 'fileParseWorker.mjs';

interface BuildOptions {
  outdir?: string;
}

/**
 * Runs the built worker on a text file, a CSV dataset and the two chunk jobs that load the heavy
 * dependencies (an xlsx through exceljs, markdown through the splitter): proves it starts, and
 * that what the knowledge base needs is inside the file and not only importable.
 */
const smokeCheckFileParseWorker = async (workerPath: string) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'file-parse-smoke-'));
  try {
    const textFile = path.join(scratch, 'smoke.txt');
    await writeFile(textFile, 'file parse worker smoke');

    const run = (workerData: unknown) =>
      new Promise<any>((resolve, reject) => {
        let message: unknown;
        const worker = new Worker(workerPath, { env: {}, execArgv: [], workerData });
        worker.on('message', (value) => (message = value));
        worker.on('error', reject);
        worker.on('exit', () =>
          message ? resolve(message) : reject(new Error('worker exited without a result')),
        );
      });

    const file = await run({ filePath: textFile, kind: 'file', mode: 'file' });
    if (file.type !== 'result' || !file.value.content.includes('smoke')) {
      throw new Error(`file job failed: ${JSON.stringify(file)}`);
    }
    const dataset = await run({
      content: 'a,b\n1,2\n',
      kind: 'dataset',
      options: { format: 'csv' },
    });
    if (dataset.type !== 'result' || dataset.value.totalCount !== 1) {
      throw new Error(`dataset job failed: ${JSON.stringify(dataset)}`);
    }

    const { Workbook } = require('exceljs') as typeof import('exceljs');
    const workbook = new Workbook();
    workbook.addWorksheet('Smoke').addRows([['name'], ['chunk smoke']]);
    const xlsx = await run({
      content: new Uint8Array(await workbook.xlsx.writeBuffer()),
      filename: 'smoke.xlsx',
      kind: 'chunk',
    });
    if (xlsx.type !== 'result' || xlsx.value[0]?.pageContent !== 'name: chunk smoke') {
      throw new Error(`xlsx chunk job failed: ${JSON.stringify(xlsx)}`);
    }
    const markdown = await run({
      content: new TextEncoder().encode('# smoke\n\nchunk smoke'),
      filename: 'smoke.md',
      kind: 'chunk',
    });
    if (markdown.type !== 'result' || !markdown.value[0]?.pageContent.includes('chunk smoke')) {
      throw new Error(`markdown chunk job failed: ${JSON.stringify(markdown)}`);
    }
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
};

export const buildFileParseWorker = async ({
  outdir = FILE_PARSE_WORKER_OUTDIR,
}: BuildOptions = {}) => {
  const { build } = require('esbuild') as typeof import('esbuild');
  await rm(outdir, { force: true, recursive: true });
  await mkdir(outdir, { recursive: true });

  await build({
    absWorkingDir: appRoot,
    banner: {
      // CommonJS dependencies inlined into an ES module still call `require`.
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    bundle: true,
    conditions: ['node'],
    entryPoints: { fileParseWorker: FILE_PARSE_WORKER_ENTRY },
    format: 'esm',
    logLevel: 'warning',
    outExtension: { '.js': '.mjs' },
    outdir,
    platform: 'node',
    target: 'node24',
    tsconfig: path.join(appRoot, 'tsconfig.json'),
  });

  const workerPath = path.join(outdir, FILE_PARSE_WORKER_FILENAME);
  await smokeCheckFileParseWorker(workerPath);
  const { size } = await stat(workerPath);
  console.info(`[file-parse-worker] built ${workerPath} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
  return workerPath;
};

const isMainModule = () => {
  const entry = process.argv[1];
  return !!entry && import.meta.url === pathToFileURL(path.resolve(entry)).href;
};

if (isMainModule()) {
  buildFileParseWorker().catch((error) => {
    console.error('[file-parse-worker] build failed:', error);
    process.exit(1);
  });
}
