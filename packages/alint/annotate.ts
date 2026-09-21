/**
 * Turn `alint --format json` output into GitHub workflow annotations so each
 * finding shows up on its line in the PR's Files changed tab, plus a short
 * table in the job summary. Findings are advisory: this always exits 0.
 *
 *   bun packages/alint/annotate.ts alint-output.json
 */
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface AlintDiagnostic {
  filePath: string;
  loc?: { start?: { line?: number } };
  message: string;
  ruleId: string;
  severity: 'error' | 'warn';
}

export interface AlintOutput {
  diagnostics: AlintDiagnostic[];
  execution?: { cached?: number; completed?: number; planned?: number };
  usage?: { totalTokens?: number };
}

/** Workflow-command escaping: `%`, `\r`, `\n` in the message; plus `,` and `:` in properties. */
const escapeData = (value: string) =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = (value: string) =>
  escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');

export const toAnnotation = (diagnostic: AlintDiagnostic, rootDir: string): string => {
  const file = path.relative(rootDir, diagnostic.filePath);
  const line = diagnostic.loc?.start?.line ?? 1;
  const level = diagnostic.severity === 'error' ? 'error' : 'warning';
  // Keep only the first paragraph: alint appends a "Suggestion:" line.
  const message = diagnostic.message.split('\n')[0];
  return `::${level} file=${escapeProperty(file)},line=${line},title=${escapeProperty(diagnostic.ruleId)}::${escapeData(message)}`;
};

export const toSummary = (output: AlintOutput, rootDir: string): string => {
  const { diagnostics, execution = {}, usage = {} } = output;
  const header = `### alint · ${diagnostics.length} finding${diagnostics.length === 1 ? '' : 's'} · ${execution.planned ?? 0} files (${execution.cached ?? 0} cached) · ${usage.totalTokens ?? 0} tokens`;
  if (diagnostics.length === 0) return `${header}\n`;
  const rows = diagnostics.map(
    (diagnostic) =>
      `| \`${path.relative(rootDir, diagnostic.filePath)}:${diagnostic.loc?.start?.line ?? 1}\` | ${diagnostic.ruleId} | ${diagnostic.message.split('\n')[0].replaceAll('|', '\\|')} |`,
  );
  return [header, '', '| Location | Rule | Finding |', '| --- | --- | --- |', ...rows, ''].join(
    '\n',
  );
};

const main = async () => {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    console.error('usage: bun packages/alint/annotate.ts <alint-output.json>');
    process.exit(2);
  }
  const rootDir = process.cwd();
  const output = JSON.parse(await readFile(inputPath, 'utf8')) as AlintOutput;

  for (const diagnostic of output.diagnostics) console.info(toAnnotation(diagnostic, rootDir));

  const summary = toSummary(output, rootDir);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.info(summary);
};

if (import.meta.main) await main();
