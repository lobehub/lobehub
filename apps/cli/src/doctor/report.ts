import pc from 'picocolors';

import { displayWidth } from '../utils/format';
import type { CheckResult, CheckStatus, DoctorReport } from './types';
import { CHECK_GROUP_ORDER, CHECK_GROUP_TITLES } from './types';

const ICONS: Record<CheckStatus, string> = { fail: '✖', ok: '✔', skip: '·', warn: '⚠' };

const paint = (status: CheckStatus, text: string): string => {
  switch (status) {
    case 'fail': {
      return pc.red(text);
    }
    case 'ok': {
      return pc.green(text);
    }
    case 'warn': {
      return pc.yellow(text);
    }
    default: {
      return pc.dim(text);
    }
  }
};

const pad = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)));

/**
 * Render the report for a terminal. The machine-readable form is the report
 * object itself — `--json` prints it verbatim, so the two never drift.
 */
export function renderReport(report: DoctorReport, options: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const titleWidth = Math.max(0, ...report.checks.map((c) => displayWidth(c.title)));

  lines.push(
    `${pc.bold('LobeHub CLI doctor')} ${pc.dim(`· ${report.cli.version} · profile ${report.profile}`)}`,
    '',
  );

  for (const group of CHECK_GROUP_ORDER) {
    const checks = report.checks.filter((check) => check.group === group);
    if (checks.length === 0) continue;

    lines.push(pc.bold(CHECK_GROUP_TITLES[group]));
    for (const check of checks) {
      lines.push(
        `  ${paint(check.status, ICONS[check.status])} ${pad(check.title, titleWidth)}  ${
          check.status === 'skip' ? pc.dim(check.detail) : check.detail
        }`,
      );
      if (check.repaired) lines.push(`      ${pc.cyan('fixed')} ${check.repaired}`);
      if (check.fix && check.status !== 'ok' && check.status !== 'skip')
        lines.push(`      ${pc.cyan('→')} ${check.fix}`);
      if (options.verbose && check.evidence)
        for (const [key, value] of Object.entries(check.evidence))
          lines.push(`      ${pc.dim(`${key}: ${formatEvidence(value)}`)}`);
    }
    lines.push('');
  }

  if (report.repairs?.some((repair) => !repair.ok)) {
    lines.push(pc.bold('Repairs that did not apply'));
    for (const repair of report.repairs.filter((r) => !r.ok))
      lines.push(`  ${pc.red('✖')} ${repair.id}: ${repair.action}`);
    lines.push('');
  }

  const { fail, ok, skip, warn } = report.summary;
  lines.push(
    [
      pc.green(`${ok} ok`),
      warn > 0 ? pc.yellow(`${warn} warning${warn === 1 ? '' : 's'}`) : pc.dim('0 warnings'),
      fail > 0 ? pc.red(`${fail} failing`) : pc.dim('0 failing'),
      pc.dim(`${skip} skipped`),
    ].join(pc.dim(' · ')),
  );

  if (fail > 0)
    lines.push(
      pc.dim('Work top to bottom: a later layer cannot be right if an earlier one is broken.'),
    );
  else if (report.profile === 'core')
    lines.push(pc.dim('Deeper checks: --profile connect | agent | hetero | selfhost | all'));

  return lines.join('\n');
}

function formatEvidence(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** One line per check, for `--json` consumers that want to grep instead. */
export function renderCompact(checks: CheckResult[]): string {
  return checks.map((check) => `${check.status}\t${check.id}\t${check.detail}`).join('\n');
}
