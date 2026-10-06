/**
 * Turn an `alint --format json` dump into one `sample-<rule>.txt` per rule — the slice a
 * classifier reads against the source during calibration (see references/calibration.md).
 *
 *   bun .agents/skills/alint-ruleset/scripts/sample-findings.ts <raw.json> [--sample 20] [--out <dir>]
 *
 * Produce the dump first:
 *   node_modules/.bin/alint --format json --rule-concurrency 32 <scope...> > raw.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface AlintDiagnostic {
  evidence?: { confidence?: string; suggestion?: string };
  filePath: string;
  loc?: { start?: { line?: number } };
  message: string;
  ruleId: string;
  severity: 'error' | 'warn';
}

interface AlintOutput {
  diagnostics?: AlintDiagnostic[];
}

/** Minimal `--flag value` / `--flag=value` / positional parser. */
const parseArgs = (argv: string[]) => {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      flags.set(key!, inline ?? argv[++index] ?? '');
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
};

const { flags, positional } = parseArgs(process.argv.slice(2));
const input = positional[0];
if (!input) {
  console.error('usage: sample-findings.ts <raw.json> [--sample 20] [--out <dir>]');
  process.exit(2);
}

const sampleSize = Number(flags.get('sample') ?? 20);
const outDir = path.resolve(flags.get('out') ?? path.join(path.dirname(path.resolve(input)), 'samples'));
const root = process.cwd();

const output = JSON.parse(await readFile(input, 'utf8')) as AlintOutput;
const diagnostics = output.diagnostics ?? [];

const byRule = new Map<string, AlintDiagnostic[]>();
for (const diagnostic of diagnostics) {
  const list = byRule.get(diagnostic.ruleId) ?? [];
  list.push(diagnostic);
  byRule.set(diagnostic.ruleId, list);
}

await mkdir(outDir, { recursive: true });

/** Cells are tab-separated; strip tabs/newlines from free text so a row stays one line. */
const cell = (value: string) => value.replaceAll('\t', ' ').replaceAll('\n', ' ').trim();

const table: string[] = ['| rule | findings | sampled | sample file |', '| --- | ---: | ---: | --- |'];
const index: Record<string, { findings: number; sampleFile: string; sampled: number }> = {};

for (const [rule, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  const picked = list.slice(0, sampleSize);
  const header = ['index', 'location', 'confidence', 'severity', 'message', 'suggestion'].join('\t');
  const rows = picked.map((diagnostic, position) => {
    const location = `${path.relative(root, diagnostic.filePath)}:${diagnostic.loc?.start?.line ?? 0}`;
    return [
      position,
      location,
      cell(diagnostic.evidence?.confidence ?? '-'),
      diagnostic.severity,
      cell(diagnostic.message.split('\n')[0] ?? ''),
      cell(diagnostic.evidence?.suggestion ?? ''),
    ].join('\t');
  });
  const fileName = `sample-${rule.replaceAll('/', '__')}.txt`;
  await writeFile(path.join(outDir, fileName), [header, ...rows].join('\n') + '\n');
  index[rule] = { findings: list.length, sampleFile: fileName, sampled: picked.length };
  table.push(`| \`${rule}\` | ${list.length} | ${picked.length} | \`${fileName}\` |`);
}

await writeFile(
  path.join(outDir, 'index.json'),
  JSON.stringify({ byRule: index, generatedAt: new Date().toISOString(), source: path.resolve(input) }, null, 2) + '\n',
);

console.info(table.join('\n'));
console.info(`\n${diagnostics.length} findings · ${byRule.size} rules · samples in ${outDir}`);
if (diagnostics.length === 0) console.info('No findings. If this was meant to be a scan, check the scope and the cache.');
