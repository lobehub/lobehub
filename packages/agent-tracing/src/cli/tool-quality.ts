import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';

import {
  buildCorpusReport,
  collectToolResults,
  type CorpusReport,
  rollupOperation,
  type ToolResultMetrics,
} from '../analysis/toolFeedback';
import type { ExecutionSnapshot } from '../types';

const dim = (s: string) => `\x1B[2m${s}\x1B[22m`;
const bold = (s: string) => `\x1B[1m${s}\x1B[22m`;
const red = (s: string) => `\x1B[31m${s}\x1B[39m`;
const yellow = (s: string) => `\x1B[33m${s}\x1B[39m`;
const green = (s: string) => `\x1B[32m${s}\x1B[39m`;
const cyan = (s: string) => `\x1B[36m${s}\x1B[39m`;

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function pad(s: string, w: number): string {
  // eslint-disable-next-line no-control-regex
  const len = s.replaceAll(/\x1B\[[0-9;]*m/g, '').length;
  return s + ' '.repeat(Math.max(0, w - len));
}
function bar(frac: number, width = 24): string {
  const n = Math.round(frac * width);
  return '█'.repeat(n) + dim('·'.repeat(width - n));
}
function heat(frac: number, s: string): string {
  if (frac >= 0.5) return red(s);
  if (frac >= 0.2) return yellow(s);
  return s;
}

async function loadSnapshots(dir: string, limit?: number): Promise<ExecutionSnapshot[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    console.error(red(`Cannot read snapshot dir: ${dir}`));
    process.exit(1);
  }
  if (limit) files = files.slice(0, limit);
  const out: ExecutionSnapshot[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
    } catch {
      // skip unreadable / non-snapshot json
    }
  }
  return out;
}

function renderCorpus(report: CorpusReport, top: number): string {
  const wasteFrac = report.tokensTotal ? report.wasteTokensTotal / report.tokensTotal : 0;
  const L: string[] = [
    '',
    bold('Tool-result feedback quality  ') +
      dim(
        `(${report.ops} ops · ${report.resultCount} results · ${fmtTokens(report.tokensTotal)} tokens)`,
      ),
    dim('  est. wasted ≈ ') +
      heat(wasteFrac, bold(`${fmtTokens(report.wasteTokensTotal)} (${pct(wasteFrac)})`)) +
      dim('  of all tool-result tokens'),
    '',
    // histogram
    bold('  token-size distribution') + dim('   bar = % of results · right = % of tokens'),
  ];
  const maxCount = Math.max(...report.buckets.map((b) => b.count), 1);
  for (const b of report.buckets) {
    const cFrac = report.resultCount ? b.count / report.resultCount : 0;
    const tFrac = report.tokensTotal ? b.tokens / report.tokensTotal : 0;
    L.push(
      '  ' +
        pad(b.label, 7) +
        bar(b.count / maxCount, 20) +
        ' ' +
        pad(dim(pct(cFrac)), 5) +
        heat(tFrac, `  ${pct(tFrac)} tok`),
    );
  }

  // leaderboard
  L.push('');
  L.push(bold('  dirty leaderboard') + dim('  (ranked by token-weighted waste)'));
  L.push(
    dim(
      '  ' +
        pad('tool', 38) +
        pad('calls', 6) +
        pad('p99', 7) +
        pad('redund', 7) +
        pad('noise', 6) +
        pad('err%', 6) +
        'waste',
    ),
  );
  for (const t of report.leaderboard.slice(0, top)) {
    L.push(
      '  ' +
        pad(t.tool.length > 36 ? t.tool.slice(0, 35) + '…' : t.tool, 38) +
        pad(String(t.calls), 6) +
        pad(fmtTokens(t.tokensP99), 7) +
        pad(heat(t.redundAvg, pct(t.redundAvg)), 7) +
        pad(heat(t.noiseAvg, pct(t.noiseAvg)), 6) +
        pad(heat(t.errRate, pct(t.errRate)), 6) +
        heat(
          t.tokensTotal ? t.wasteTokens / t.tokensTotal : 0,
          bold(`≈${fmtTokens(t.wasteTokens)}`),
        ),
    );
  }
  L.push('');
  L.push(dim('  drill into one op:  agent-tracing tq <opId>'));
  L.push('');
  return L.join('\n');
}

function renderOp(snapshot: ExecutionSnapshot): string {
  const results = collectToolResults(snapshot).sort((a, b) => a.stepIndex - b.stepIndex);
  const roll = rollupOperation(snapshot);
  const L: string[] = [
    '',
    bold(`Op ${snapshot.operationId}`) + dim(`  ${results.length} tool results`),
    dim('  total ') +
      cyan(fmtTokens(roll.tokensTotal)) +
      dim(' tok · p99 ') +
      fmtTokens(roll.tokensP99) +
      dim(' · max ') +
      fmtTokens(roll.tokensMax) +
      dim(' · errors ') +
      (roll.errorResultCount
        ? red(`${roll.errorResultCount} (${fmtTokens(roll.errorResultTokens)} tok)`)
        : green('0')),
    '',
    dim(
      '  ' +
        pad('step', 5) +
        pad('tool', 40) +
        pad('fmt', 6) +
        pad('tokens', 8) +
        pad('redund', 7) +
        pad('noise', 6) +
        'err',
    ),
  ];
  for (const r of results) {
    L.push(
      '  ' +
        pad(String(r.stepIndex), 5) +
        pad(r.tool.length > 38 ? r.tool.slice(0, 37) + '…' : r.tool, 40) +
        pad(r.format, 6) +
        pad(heat(Math.min(1, r.tokens / 8192), fmtTokens(r.tokens)), 8) +
        pad(heat(r.selfRedundancy, pct(r.selfRedundancy)), 7) +
        pad(heat(r.structuralNoiseRatio, pct(r.structuralNoiseRatio)), 6) +
        (r.isError ? red('✗') : green('·')),
    );
  }
  L.push('');
  return L.join('\n');
}

export function registerToolQualityCommand(program: Command) {
  program
    .command('tool-quality')
    .alias('tq')
    .description('Analyze tool-result feedback quality (size distribution + dirty leaderboard)')
    .argument('[opId]', 'Operation id — drill into one op instead of corpus stats')
    .option('-d, --dir <path>', 'Snapshot directory to scan', '.agent-tracing/_remote')
    .option('-l, --limit <n>', 'Max snapshots to scan')
    .option('-t, --top <n>', 'Leaderboard rows to show', '15')
    .option('-j, --json', 'Output JSON')
    .action(
      async (
        opId: string | undefined,
        opts: { dir: string; json?: boolean; limit?: string; top: string },
      ) => {
        const dir = path.resolve(process.cwd(), opts.dir);

        if (opId) {
          const file = path.join(dir, opId.endsWith('.json') ? opId : `${opId}.json`);
          let snapshot: ExecutionSnapshot;
          try {
            snapshot = JSON.parse(await readFile(file, 'utf8'));
          } catch {
            console.error(red(`Snapshot not found: ${file}`));
            process.exit(1);
          }
          if (opts.json) {
            console.log(JSON.stringify(rollupOperation(snapshot), null, 2));
          } else {
            console.log(renderOp(snapshot));
          }
          return;
        }

        const limit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined;
        const snapshots = await loadSnapshots(dir, limit);
        const perResult: ToolResultMetrics[] = snapshots.flatMap((s) => collectToolResults(s));
        const report = buildCorpusReport(perResult, snapshots.length);

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(renderCorpus(report, Number.parseInt(opts.top, 10) || 15));
        }
      },
    );
}
