import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { resolveServerUrl } from '../../../settings';
import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { assertReportLanguage, evidenceCaptionFields } from '../language';
import {
  type Decision,
  DECISIONS,
  evidenceDescriptionForFile,
  evidenceMetadataFromOptions,
  inlineTextEvidenceForFile,
  printResults,
} from '../utils';
import { uploadAcceptanceFile } from './evidenceUpload';

// ── result ──

export interface ResultIngestOptions {
  check: string;
  confidence?: string;
  evidence?: string;
  index?: string;
  json?: boolean | string;
  run: string;
  soft?: boolean;
  status?: string;
  suggestion?: string;
  title?: string;
  verdict: string;
}

export async function resultIngestAction(options: ResultIngestOptions): Promise<void> {
  const client = await getTrpcClient();
  await assertReportLanguage(client, [
    { path: '--title', text: options.title },
    { path: '--evidence', text: options.evidence },
    { path: '--suggestion', text: options.suggestion },
  ]);
  const created = await client.verify.ingestResult.mutate({
    checkItemId: options.check,
    checkItemIndex: options.index ? Number.parseInt(options.index, 10) : undefined,
    checkItemTitle: options.title,
    confidence: options.confidence ? Number.parseFloat(options.confidence) : undefined,
    required: options.soft ? false : undefined,
    status: options.status as any,
    suggestion: options.suggestion,
    toulmin: options.evidence ? { evidence: options.evidence } : undefined,
    verdict: options.verdict as any,
    verifyRunId: options.run,
  });
  if (options.json !== undefined) {
    outputJson(created, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Result ${pc.bold(created.id)} (${created.verdict})`);
}

export async function resultListAction(options: {
  json?: boolean | string;
  operation?: string;
  run?: string;
}): Promise<void> {
  if (!options.run && !options.operation) {
    log.error('Provide either --run or --operation');
    process.exit(1);
  }
  const client = await getTrpcClient();
  const results = options.run
    ? await client.verify.listResultsByRun.query({ verifyRunId: options.run })
    : await client.verify.listResults.query({ operationId: options.operation! });
  if (options.json !== undefined) {
    outputJson(results, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (results.length === 0) return void console.log('No results yet.');
  printResults(results);
}

export interface SubmitOptions {
  by?: string;
  chapters?: string;
  content?: string;
  desc?: string;
  file?: string;
  item: string;
  json?: boolean | string;
  metadata?: string;
  operation?: string;
  run?: string;
  title?: string;
  type?: string;
  verdict?: string;
}

export async function submitAction(options: SubmitOptions): Promise<void> {
  if (!options.run && !options.operation) {
    log.error('Provide --run <verifyRunId> or --operation <operationId>');
    process.exit(1);
  }
  const hasEvidence = Boolean(options.file) || Boolean(options.content);
  if (Boolean(options.file) && Boolean(options.content)) {
    log.error('Provide at most one of --file or --content');
    process.exit(1);
  }
  if (hasEvidence && !options.type) {
    log.error('--type is required when attaching evidence');
    process.exit(1);
  }
  if (!hasEvidence && !options.verdict) {
    log.error('Provide evidence (--file/--content) and/or a --verdict');
    process.exit(1);
  }
  if (!hasEvidence && (options.chapters || options.metadata)) {
    log.error('--chapters/--metadata describe evidence: pass --file or --content too');
    process.exit(1);
  }
  // Parse before uploading: a bad chapters file must not leave an orphan upload.
  const metadata = evidenceMetadataFromOptions(options);
  const client = await getTrpcClient();
  await assertReportLanguage(client, [
    { path: '--title', text: options.title },
    { path: '--desc', text: options.desc },
    // Chapter labels/notes and comparison labels render on the page as prose too.
    ...evidenceCaptionFields(options.chapters ? '--chapters' : '--metadata', metadata),
  ]);
  let fileId: string | undefined;
  let inlineContent = options.content;
  if (options.file) {
    inlineContent = inlineTextEvidenceForFile(options.file, options.type!);
    if (inlineContent === undefined) {
      const uploaded = await uploadAcceptanceFile(client, options.file, options.json);
      if (!uploaded) return;
      fileId = uploaded.id;
    }
  }
  const evidence = hasEvidence
    ? [
        {
          capturedBy: options.by as any,
          content: inlineContent,
          description: evidenceDescriptionForFile(options.desc, options.file),
          fileId,
          metadata,
          type: options.type as any,
        },
      ]
    : undefined;
  const res = await client.verify.submitCheckEvidence.mutate({
    checkItemId: options.item,
    checkItemTitle: options.title,
    evidence,
    operationId: options.operation,
    verdict: options.verdict as any,
    verifyRunId: options.run,
  });
  const verifyRunId = res.checkResult.verifyRunId ?? options.run;
  if (!verifyRunId) {
    log.error('Submitted result did not resolve to a verification run');
    process.exit(1);
  }
  // The acceptance page is the only report surface; a round not attached to one
  // has no link to hand off (the plan handoff lookup reports it as blocked).
  const round = await client.verify.getRun.query({ verifyRunId }).catch(() => null);
  const acceptanceUrl = round?.acceptanceId
    ? new URL(
        `/acceptance/${encodeURIComponent(round.acceptanceId)}`,
        resolveServerUrl(),
      ).toString()
    : null;
  if (options.json !== undefined) {
    outputJson(
      { ...res, acceptanceUrl, roundIndex: round?.roundIndex ?? null },
      typeof options.json === 'string' ? options.json : undefined,
    );
    return;
  }
  console.log(
    `${pc.green('✓')} Submitted ${pc.bold(res.checkResult.id)}` +
      `${res.checkResult.verdict ? ` (${res.checkResult.verdict})` : ''}` +
      `${res.evidence.length > 0 ? ` +${res.evidence.length} evidence` : ''}`,
  );
  console.log(
    acceptanceUrl
      ? `${pc.bold('acceptance')}: ${acceptanceUrl}`
      : pc.dim('round not attached to an acceptance yet — no link to hand off'),
  );
}

export async function decisionAction(resultId: string, decision: Decision): Promise<void> {
  if (decision !== undefined && !DECISIONS.includes(decision)) {
    log.error(`decision must be one of: ${DECISIONS.join(', ')}`);
    process.exit(1);
  }
  const client = await getTrpcClient();
  await client.verify.submitDecision.mutate({ decision, resultId });
  console.log(`${pc.green('✓')} Recorded ${pc.bold(decision)} on result ${pc.bold(resultId)}`);
}

export function withResultIngestOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--run <verifyRunId>', 'Target session id')
    .requiredOption('--check <checkItemId>', 'Stable check item id within the session')
    .requiredOption('--verdict <verdict>', 'passed|failed|uncertain')
    .option('--title <title>', 'Check title')
    .option('--index <n>', 'Display index')
    .option('--confidence <n>', '0-1 confidence')
    .option('--status <status>', 'pending|running|passed|failed|skipped (derived from verdict)')
    .option('--evidence <text>', 'Key observation (stored as Toulmin evidence)')
    .option('--suggestion <text>', 'Remediation hint')
    .option('--soft', 'Non-blocking (required=false); defaults to blocking')
    .option('--json [fields]', 'Output JSON');
}

export function withResultListOptions(cmd: Command): Command {
  return cmd
    .option('--run <verifyRunId>', 'List by verification session')
    .option('--operation <operationId>', 'List by Agent Run')
    .option('--json [fields]', 'Output JSON');
}

export function withSubmitOptions(cmd: Command): Command {
  return cmd
    .option('--run <verifyRunId>', 'Target verification session (or use --operation)')
    .option('--operation <operationId>', 'Resolve the session from an Agent Run operation id')
    .requiredOption('--item <checkItemId>', 'Plan item id (checkItemId)')
    .option('--type <type>', 'screenshot|gif|video|audio|text|markdown|dom_snapshot|transcript')
    .option('--file <path>', 'Local file to upload as the evidence artifact')
    .option('--content <text>', 'Inline text payload (instead of a file)')
    .option('--verdict <verdict>', 'passed|failed|uncertain')
    .option('--title <text>', 'Check item title snapshot')
    .option('--by <capturedBy>', 'agent-browser|cdp|cli|program|llm_judge', 'cli')
    .option('--desc <text>', 'Human-readable caption for the evidence')
    .option('--chapters <file>', 'Video chapters JSON (steps, checks, flags on the timeline)')
    .option('--metadata <json>', 'Evidence metadata JSON object')
    .option('--json [fields]', 'Output JSON');
}
