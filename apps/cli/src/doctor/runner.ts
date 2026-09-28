import { cliVersion } from '../pkg';
import { scrubDeep } from './redact';
import type {
  CheckResult,
  CheckStatus,
  DoctorCheck,
  DoctorContext,
  DoctorOptions,
  DoctorReport,
} from './types';

/** A check body that hangs must not hang `lh doctor`. */
async function withTimeout<T>(
  run: () => Promise<T> | T,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isSelected(check: DoctorCheck, profile: DoctorOptions['profile']): boolean {
  if (profile === 'all') return true;
  // `core` is the baseline: its checks run under every profile.
  return check.profiles.includes('core') || check.profiles.includes(profile);
}

/**
 * Why this check cannot run right now, or undefined when it can.
 *
 * A dependency that failed or was skipped short-circuits everything behind it:
 * reporting "credentials rejected" when the server was never reachable sends
 * the user after the wrong problem, which is the failure mode doctor exists to
 * remove.
 */
function skipReason(
  check: DoctorCheck,
  options: DoctorOptions,
  results: Map<string, CheckResult>,
): string | undefined {
  if (check.network && options.offline) return '--offline';
  if (check.deep && !options.deep) return '--deep not set';

  for (const dependency of check.dependsOn ?? []) {
    const upstream = results.get(dependency);
    if (!upstream) return dependency;
    if (upstream.status === 'fail' || upstream.status === 'skip') return dependency;
  }

  return undefined;
}

function worstStatus(results: CheckResult[]): DoctorReport['status'] {
  if (results.some((r) => r.status === 'fail')) return 'fail';
  if (results.some((r) => r.status === 'warn')) return 'warn';
  return 'ok';
}

export function summarize(results: CheckResult[]): Record<CheckStatus, number> {
  const summary: Record<CheckStatus, number> = { fail: 0, ok: 0, skip: 0, warn: 0 };
  for (const result of results) summary[result.status] += 1;
  return summary;
}

/**
 * The exit code contract: 0 when nothing failed, 1 when something did.
 * `--strict` promotes warnings to failures. Nothing else is expressed through
 * the exit code — a caller that needs detail reads `--json`.
 */
export function exitCodeFor(report: DoctorReport, strict: boolean): number {
  if (report.status === 'fail') return 1;
  if (strict && report.status === 'warn') return 1;
  return 0;
}

export async function runDoctor(
  checks: readonly DoctorCheck[],
  options: DoctorOptions,
): Promise<DoctorReport> {
  const results = new Map<string, CheckResult>();
  const probes = new Map<string, Promise<unknown>>();
  const repairs: NonNullable<DoctorReport['repairs']> = [];

  const ctx: DoctorContext = {
    options,
    probe: <T>(key: string, load: () => Promise<T>): Promise<T> => {
      const existing = probes.get(key);
      if (existing) return existing as Promise<T>;
      const started = load();
      probes.set(key, started);
      return started;
    },
    result: (id) => results.get(id),
  };

  const execute = async (check: DoctorCheck): Promise<CheckResult> => {
    const startedAt = Date.now();
    try {
      const outcome = await withTimeout(
        () => check.run(ctx),
        // Local checks share the default budget; they never approach it.
        check.budgetMs?.(options) ?? options.timeoutMs,
        check.title,
      );
      return {
        ...outcome,
        durationMs: Date.now() - startedAt,
        group: check.group,
        id: check.id,
        title: check.title,
      };
    } catch (error) {
      return {
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        fix: 'Re-run with --verbose for the full error.',
        group: check.group,
        id: check.id,
        status: 'fail',
        title: check.title,
      };
    }
  };

  for (const check of checks) {
    if (!isSelected(check, options.profile)) continue;

    const skipped = skipReason(check, options, results);
    if (skipped) {
      results.set(check.id, {
        detail: `Not run (${skipped}).`,
        durationMs: 0,
        group: check.group,
        id: check.id,
        skippedBecause: skipped,
        status: 'skip',
        title: check.title,
      });
      continue;
    }

    let result = await execute(check);

    // `evidence.repairable` is the check's own statement that this finding is
    // actionable. Without it, a warning like "no daemon is running" would
    // otherwise invoke a repair that has nothing to undo.
    const repairable =
      options.fix &&
      check.repair &&
      (result.status === 'fail' || result.status === 'warn') &&
      Boolean(result.evidence?.repairable);

    if (repairable) {
      try {
        const action = await check.repair(ctx, result);
        repairs.push({ action: scrubDeep(action), id: check.id, ok: true });
        // Re-run so the report describes the world after the repair, not before.
        result = { ...(await execute(check)), repaired: action };
      } catch (error) {
        repairs.push({
          action: scrubDeep(error instanceof Error ? error.message : String(error)),
          id: check.id,
          ok: false,
        });
      }
    }

    // The report exists to be pasted into an issue. Scrub centrally rather than
    // trusting every check to redact everything it touches: error messages from
    // fetch and the gateway client quote URLs, and evidence copies config
    // verbatim, in more places than per-check redaction ever caught.
    results.set(check.id, scrubDeep(result));
  }

  const checkResults = [...results.values()];

  return {
    checks: checkResults,
    cli: { bin: process.argv[1] ?? 'lh', version: cliVersion },
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    ...(repairs.length > 0 ? { repairs } : {}),
    status: worstStatus(checkResults),
    summary: summarize(checkResults),
  };
}
