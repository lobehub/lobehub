import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { LocalDeliveryDecision } from '@lobechat/utils/verify/localAcceptance';
import {
  assembleLocalAcceptance,
  localDecisionEvent,
  mergeLocalReviewEvents,
} from '@lobechat/utils/verify/localAcceptance';
import pc from 'picocolors';

import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { REPORT_FILE } from './acceptanceDir';
import { loadLocalAcceptance, writeReviewLog } from './localAcceptance';
import { writeReportPage } from './render';

/**
 * `lh acceptance accept|reject <acceptanceDir>`: the decision on the whole
 * delivery, recorded in the local review log the way the report page records
 * it, with the server's refusals. A rendered `report.html` is refreshed so the
 * page shows the decision too.
 */
export async function decideLocalAcceptance(
  target: string,
  action: LocalDeliveryDecision,
  options: { comment?: string; json?: boolean | string },
) {
  // Reading first files any review the page saved since, so the decision
  // lands on the acceptance as the reviewer last left it.
  const read = loadLocalAcceptance(target);
  const decide = () => {
    try {
      return localDecisionEvent(assembleLocalAcceptance(read.source), {
        action,
        comment: options.comment,
        createdAt: new Date().toISOString(),
        id: randomUUID(),
      });
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  };
  const event = decide();

  const reviews = mergeLocalReviewEvents(read.source.reviews, [event]);
  writeReviewLog(read.acceptanceDir, read.info.id, reviews);
  const source = { ...read.source, reviews };
  const { acceptance } = assembleLocalAcceptance(source);

  let reportPath: string | null = null;
  if (existsSync(path.join(read.acceptanceDir, REPORT_FILE))) {
    try {
      reportPath = writeReportPage(read.acceptanceDir, source);
    } catch (error) {
      log.warn(
        `Decision recorded, but report.html was not refreshed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const result = {
    acceptanceDir: read.acceptanceDir,
    acceptanceId: read.info.id,
    decision: event,
    reportPath,
    status: acceptance.status,
  };
  if (options.json !== undefined) {
    outputJson(result, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(
    action === 'accept'
      ? `${pc.green('✓')} Delivery accepted (${read.info.id}, local)`
      : `${pc.red('✗')} Delivery rejected (${read.info.id}, local) — the next round re-opens it`,
  );
  if (reportPath) console.log(`${pc.bold('report')}: ${reportPath}`);
}
