import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';

import { type ContextLintResult, type LintFinding, lintSnapshot } from '../analysis/contextLint';
import { FileSnapshotStore } from '../store/file-store';
import { isOperationId, RemoteSnapshotStore } from '../store/remote-store';
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

function sevIcon(f: LintFinding): string {
  return f.severity === 'error' ? red('✖') : yellow('⚠');
}

function renderResult(result: ContextLintResult): string {
  const { features: ft, findings } = result;
  const lines: string[] = [];
  const scoreColor = ft.lintScore >= 90 ? green : ft.lintScore >= 70 ? yellow : red;
  lines.push(
    `${bold('ctx-lint')}  ${cyan(ft.operationId)}  score ${scoreColor(String(ft.lintScore))}  ` +
      dim(
        `payload ${fmtTokens(ft.finalPayloadTokens)} tok / ${ft.payloadMessages} msgs / source=${ft.payloadSource}`,
      ),
  );
  lines.push(
    dim(
      `  system ${fmtTokens(ft.systemTokens)} (${Math.round(ft.systemShare * 100)}%)  ` +
        `tool-results ${fmtTokens(ft.toolMsgTokens)} (${Math.round(ft.toolMsgShare * 100)}%)  ` +
        `tools ${ft.toolsCalled}/${ft.toolsOffered} used  dup ${Math.round(ft.dupShare * 100)}%`,
    ),
  );
  if (findings.length === 0) {
    lines.push(green('  ✓ no findings'));
    return lines.join('\n');
  }
  const sorted = [...findings].sort((a, b) => b.wasteTokens - a.wasteTokens);
  for (const f of sorted) {
    const loc = `step ${f.stepIndex}${f.messageIndex === undefined ? '' : ` msg[${f.messageIndex}]`}`;
    const tool = f.tool ? ` ${cyan(f.tool)}` : '';
    const waste = f.wasteTokens > 0 ? dim(`  −${fmtTokens(f.wasteTokens)} tok`) : '';
    lines.push(
      `  ${sevIcon(f)} ${bold(f.rule.padEnd(26))} ${dim(loc)}${tool}  ${f.detail}${waste}`,
    );
  }
  return lines.join('\n');
}

async function loadFromDir(dir: string, limit?: number): Promise<ExecutionSnapshot[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const selected = limit ? files.slice(0, limit) : files;
  const out: ExecutionSnapshot[] = [];
  for (const f of selected) {
    try {
      const snap = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      if (snap?.operationId && Array.isArray(snap.steps)) out.push(snap);
    } catch {
      // skip non-snapshot json
    }
  }
  return out;
}

export function registerCtxLintCommand(program: Command) {
  program
    .command('ctx-lint')
    .alias('cl')
    .description('Lint the assembled LLM context of one operation or a snapshot corpus')
    .argument('[target]', 'operation id, snapshot json path, or directory of snapshots')
    .option('-l, --limit <n>', 'max snapshots when target is a directory')
    .option('-j, --json', 'JSON output (per-op features + findings)')
    .option('--features-only', 'JSONL feature vectors only (for downstream analysis)')
    .action(
      async (
        target: string | undefined,
        opts: { featuresOnly?: boolean; json?: boolean; limit?: string },
      ) => {
        let snapshots: ExecutionSnapshot[];

        if (target && isOperationId(target)) {
          const store = new FileSnapshotStore();
          let snap = await store.get(target);
          if (!snap) snap = await new RemoteSnapshotStore().getCached(target);
          if (!snap) {
            console.error(
              red(
                `Snapshot not found for ${target} (fetch it first via \`agent-tracing inspect\`)`,
              ),
            );
            process.exit(1);
          }
          snapshots = [snap];
        } else if (target) {
          const stat = await import('node:fs/promises').then((fs) => fs.stat(target));
          snapshots = stat.isDirectory()
            ? await loadFromDir(target, opts.limit ? Number.parseInt(opts.limit, 10) : undefined)
            : [JSON.parse(await readFile(target, 'utf8'))];
        } else {
          const store = new FileSnapshotStore();
          const latest = await store.getLatest();
          if (!latest) {
            console.error(red('No local snapshot found.'));
            process.exit(1);
          }
          snapshots = [latest];
        }

        const results = snapshots.map((s) => lintSnapshot(s));

        if (opts.featuresOnly) {
          for (const r of results) console.log(JSON.stringify(r.features));
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
          return;
        }
        for (const r of results) console.log(renderResult(r) + '\n');
      },
    );
}
