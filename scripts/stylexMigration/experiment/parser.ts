import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromVite = createRequire(import.meta.resolve('vite'));
const { transform } = requireFromVite('lightningcss') as {
  transform: (options: { code: Buffer; filename: string; minify: boolean }) => {
    code: Buffer;
    warnings: unknown[];
  };
};

const main = async () => {
  const output = path.resolve(process.argv[2] ?? '.records/stylex-migration-experiment/pilot');
  const results = [];
  for (const side of ['before', 'after']) {
    const directory = path.join(output, side, 'dist/assets');
    const cssFiles = (await readdir(directory)).filter((file) => file.endsWith('.css'));
    const input = Buffer.from(
      (
        await Promise.all(cssFiles.map((file) => readFile(path.join(directory, file), 'utf8')))
      ).join('\n'),
    );
    const samples = [];
    let warnings = 0;
    let outputBytes = 0;
    for (let iteration = 0; iteration < 20; iteration++) {
      const started = performance.now();
      const result = transform({ code: input, filename: 'component-bundle.css', minify: true });
      samples.push(performance.now() - started);
      warnings = result.warnings.length;
      outputBytes = result.code.length;
    }
    results.push({ inputBytes: input.length, outputBytes, samples, side, warnings });
  }
  const classRenaming = ['.item{color:blue;padding:8px}', '.renamed{color:blue;padding:8px}'].map(
    (css) =>
      createHash('sha256')
        .update(
          transform({ code: Buffer.from(css), filename: 'positive-control.css', minify: true })
            .code,
        )
        .digest('hex'),
  );
  const result = {
    classRenaming,
    node: process.version,
    note: 'Parser/transform timings only. No DOM, cascade or layout is resolved. Equivalent class-renaming controls produce different CSS hashes.',
    results,
    version: requireFromVite('lightningcss/package.json').version,
  };
  await writeFile(path.join(output, 'parser.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      results.map((result) => ({
        bytes: result.inputBytes,
        medianMs: [...result.samples].sort((a, b) => a - b)[10],
        side: result.side,
        warnings: result.warnings,
      })),
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
