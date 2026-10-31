import pc from 'picocolors';

import { printTable, truncate } from '../../../utils/format';

export type Verdict = 'failed' | 'passed' | 'uncertain';
/** Map a free-form case/summary result token onto the verify verdict vocabulary. */
export function toVerdict(raw: unknown): Verdict {
  const s = String(raw ?? '').toLowerCase();
  if (['pass', 'passed', 'ok', 'success'].includes(s)) return 'passed';
  if (['fail', 'failed', 'error'].includes(s)) return 'failed';
  return 'uncertain'; // partial / blocked / skipped / pending / unknown
}

/**
 * The report's headline verdict when the author didn't set `summary.verdict`:
 * derived from the ingested cases, so a report can never ship verdict-less and
 * render as a permanent "?" in every list surface.
 */
export function deriveReportVerdict(cases: unknown[]): Verdict | undefined {
  // Same field fallback as the per-case ingest (`result ?? status ?? verdict`) —
  // the documented case field is `status`, so dropping it here derived
  // `uncertain` for an all-pass report whenever this fallback actually ran.
  const verdicts = cases.map((c) =>
    toVerdict((c as any)?.result ?? (c as any)?.status ?? (c as any)?.verdict),
  );
  if (verdicts.length === 0) return undefined;
  if (verdicts.includes('failed')) return 'failed';
  if (verdicts.includes('uncertain')) return 'uncertain';
  return 'passed';
}

export function printResults(results: any[]): void {
  printTable(
    results.map((r) => [
      truncate(r.checkItemTitle || r.checkItemId, 50),
      statusColor(r.status),
      r.verdict ?? '',
      r.confidence != null ? String(r.confidence) : '',
      r.required ? 'gate' : 'soft',
      truncate(r.suggestion || '', 40),
    ]),
    ['CHECK', 'STATUS', 'VERDICT', 'CONF', 'BLOCK', 'SUGGESTION'],
  );
}

export function statusColor(status: string): string {
  if (status === 'passed') return pc.green(status);
  if (status === 'failed') return pc.red(status);
  if (status === 'running') return pc.yellow(status);
  return pc.dim(status);
}
