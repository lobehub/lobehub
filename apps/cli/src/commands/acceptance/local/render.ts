import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Command } from 'commander';
import pc from 'picocolors';

import { ensureAcceptanceDirIgnoredFor } from '../../../utils/acceptanceDir';
import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { ReportRoundError } from '../run/reportRound';
import { REPORT_FILE } from './acceptanceDir';
import { loadLocalAcceptance } from './localAcceptance';
import { readReportTemplate, renderReportHtml } from './reportTemplate';

export interface RenderReportOptions {
  json?: boolean | string;
  open?: boolean;
  requirement?: string;
  reviews?: string;
}

/**
 * Open a file in the default browser, without waiting on it. Never through a
 * shell: the path is whatever directory the acceptance lives in, and `cmd`
 * would parse its `&` or `^`.
 */
const openInBrowser = (file: string) => {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [file]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', file]]
        : ['xdg-open', [file]];
  const onError = (error: unknown) => {
    log.warn(
      `Could not open browser automatically: ${error instanceof Error ? error.message : String(error)}. Open the report path manually.`,
    );
  };
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', onError);
    child.unref();
  } catch (error) {
    onError(error);
  }
};

/**
 * Render a local acceptance into one offline page — the acceptance page,
 * without LobeHub. Re-rendering after a new round or after the reviewer saved
 * their decisions refreshes the same `report.html`.
 */
export async function renderReportAction(reportDir: string, options: RenderReportOptions) {
  ensureAcceptanceDirIgnoredFor(path.resolve(reportDir));
  let read: ReturnType<typeof loadLocalAcceptance>;
  try {
    read = loadLocalAcceptance(reportDir, {
      create: true,
      requirement: options.requirement,
      reviewsFile: options.reviews,
      warnLatest: true,
    });
  } catch (error) {
    if (error instanceof ReportRoundError) {
      for (const line of error.lines) log.error(line);
      process.exit(1);
    }
    throw error;
  }

  const { acceptanceDir, info, rounds, source } = read;
  const latest = rounds.at(-1);
  if (!latest) {
    log.error(`${acceptanceDir} has no round yet — write a round directory with result.json first`);
    process.exit(1);
  }
  if (read.keptRequirement)
    log.warn(`The requirement is recorded once per acceptance; keeping "${read.keptRequirement}".`);
  if (!info.requirement)
    log.warn(
      'No requirement recorded — pass --requirement "<one-sentence business goal>" on the first render.',
    );

  const reportPath = path.join(acceptanceDir, REPORT_FILE);
  const title = latest.source.run.title || latest.source.run.goal || path.basename(acceptanceDir);
  writeFileSync(reportPath, renderReportHtml(readReportTemplate(), source, title));
  const reportUrl = pathToFileURL(reportPath).toString();
  if (options.open) openInBrowser(reportPath);

  const partial = latest.failedEvidence.length > 0 || latest.missingEvidence.length > 0;
  if (partial) {
    process.exitCode = 1;
    log.warn(
      'Report rendered, but its evidence is incomplete. Capture the missing evidence and write a new round; do not edit this one.',
    );
  }

  const summary = {
    acceptanceDir,
    acceptanceId: info.id,
    cases: latest.source.results.length,
    droppedProgrammaticChecks: latest.droppedLabels,
    evidence: latest.source.evidence.length,
    failedEvidence: latest.failedEvidence,
    missingEvidence: latest.missingEvidence,
    mode: 'local' as const,
    planItems: latest.source.run.plan?.length ?? 0,
    publicationStatus: partial ? ('partial' as const) : ('complete' as const),
    published: info.remote ? { acceptanceUrl: info.remote.acceptanceUrl } : null,
    reportPath,
    reportUrl,
    reviews: {
      imported: read.reviewsImported ?? null,
      recorded: source.reviews.length,
    },
    roundIndex: latest.source.run.roundIndex,
    rounds: rounds.length,
    unexecuted: latest.unexecuted,
  };

  if (options.json !== undefined) {
    outputJson(summary, typeof options.json === 'string' ? options.json : undefined);
    return summary;
  }

  console.log(
    `${partial ? pc.yellow('⚠ Rendered with gaps') : pc.green('✓ Rendered')} round ${summary.roundIndex} of ${summary.rounds}: ${pc.bold(String(summary.cases))} case(s), ${pc.bold(String(summary.evidence))} evidence artifact(s)` +
      `${latest.droppedLabels.length > 0 ? pc.yellow(` — ${latest.droppedLabels.length} programmatic-test check(s) dropped`) : ''}`,
  );
  if (read.reviewsImported?.added)
    console.log(
      `${pc.bold('reviews')}: ${read.reviewsImported.added} new decision(s) read from ${read.reviewsImported.file}`,
    );
  console.log(`${pc.bold('acceptance')}: ${info.id} ${pc.dim('(local)')}`);
  console.log(`${pc.bold('report')}: ${reportUrl}`);
  return summary;
}

export function withRenderReportOptions(cmd: Command): Command {
  return cmd
    .option(
      '--requirement <text>',
      'Acceptance requirement, recorded on the first render and kept for later rounds',
    )
    .option('--reviews <file>', 'Read the review log the report page saved from this file')
    .option('--open', 'Open the rendered report in the default browser')
    .option('--json [fields]', 'Output JSON');
}
