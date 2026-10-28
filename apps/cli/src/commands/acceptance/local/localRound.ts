import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { normalizeEvidenceMetadata } from '@lobechat/const/verify';
import type { VerifyRunContext, VerifyRunMetadata } from '@lobechat/types';
import type { CoverageEvidence } from '@lobechat/utils/verify/evidenceCoverage';
import type {
  LocalEvidenceSource,
  LocalResultSource,
  LocalRoundSource,
} from '@lobechat/utils/verify/localAcceptance';

import { log } from '../../../utils/logger';
import {
  loadTerminalBundle,
  terminalBundleDir,
  terminalEvidenceDescription,
} from '../../../utils/terminalEvidence/bundle';
import {
  caseResult,
  missingEvidenceLimitation,
  publishedVerdictFor,
  readReportRound,
  requiredEvidenceGaps,
  settleReport,
  unexecutedEvidenceGaps,
} from '../run/reportRound';
import {
  evidenceDescriptionForFile,
  type EvidenceType,
  evidenceTypeForFile,
  INLINE_TEXT_EVIDENCE_TYPES,
  interactionCostFromReportDir,
  metadataForReport,
  reportEvidence,
  type Verdict,
} from '../utils';
import { localEvidenceId, localId, roundCreatedAt } from './acceptanceDir';
import { readImageSize } from './imageSize';

/**
 * A page opened from disk cannot fetch a sibling file, so text evidence is
 * carried in the page itself — up to this size. Bigger logs stay files the
 * reader opens directly.
 */
const LOCAL_INLINE_TEXT_LIMIT = 256 * 1024;

const inlineText = (file: string, type: EvidenceType): string | null => {
  if (!INLINE_TEXT_EVIDENCE_TYPES.has(type)) return null;
  try {
    if (statSync(file).size > LOCAL_INLINE_TEXT_LIMIT) return null;
    const buffer = readFileSync(file);
    if (buffer.includes(0)) return null;
    const content = buffer.toString('utf8');
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
};

/** A path the page can load: relative to the acceptance directory, URL-encoded. */
const pageUrl = (acceptanceDir: string, file: string) =>
  path.relative(acceptanceDir, file).split(path.sep).map(encodeURIComponent).join('/');

export interface LocalRoundRead {
  droppedLabels: string[];
  failedEvidence: { checkItemId: string; path: string; reason: 'file_missing' }[];
  missingEvidence: { checkItemId: string; types: EvidenceType[] }[];
  source: LocalRoundSource;
  unexecuted: string[];
}

/**
 * Read one round directory into the rows `ingest` would publish for it —
 * through the same reader, so the local page shows exactly the checks,
 * verdicts and evidence gaps the hosted one would.
 */
export function readLocalRound(params: {
  acceptanceDir: string;
  acceptanceId: string;
  dir: string;
  roundIndex: number;
  /** Only the round being rendered now warns about its own authoring gaps. */
  warn?: boolean;
}): LocalRoundRead {
  const { acceptanceDir, acceptanceId, dir, roundIndex } = params;
  const roundPath = path.join(acceptanceDir, dir);
  const round = readReportRound(roundPath, { inferPullRequest: false, quiet: !params.warn });
  const createdAt =
    typeof round.result.createdAt === 'string' &&
    !Number.isNaN(new Date(round.result.createdAt).getTime())
      ? new Date(round.result.createdAt).toISOString()
      : roundCreatedAt(acceptanceDir, dir);
  const runId = localId(acceptanceId, 'run', dir);

  const results: LocalResultSource[] = [];
  const evidence: LocalEvidenceSource[] = [];
  const missingEvidence: LocalRoundRead['missingEvidence'] = [];
  const failedEvidence: LocalRoundRead['failedEvidence'] = [];
  const publishedVerdicts: Verdict[] = [];
  const executed = new Set<string>();

  for (const [index, { case: c, checkItemId }] of round.cases.entries()) {
    executed.add(checkItemId);
    const result = caseResult(c, checkItemId, index, round.caseMetadata[index]);
    const resultId = localId(acceptanceId, 'result', dir, checkItemId);

    const present: CoverageEvidence[] = [];
    for (const [position, input] of reportEvidence(c.evidence).entries()) {
      const file = path.resolve(roundPath, input.path);
      if (!existsSync(file)) {
        failedEvidence.push({ checkItemId, path: file, reason: 'file_missing' });
        if (params.warn) log.warn(`evidence not found: ${input.path}`);
        continue;
      }
      // A terminal bundle renders as its command card with the transcript
      // inline: a page opened from disk cannot fetch the stream files or the
      // recording, so the card falls back to the text record it carries.
      if (terminalBundleDir(file)) {
        let bundle: ReturnType<typeof loadTerminalBundle>;
        try {
          bundle = loadTerminalBundle(file);
        } catch (error) {
          failedEvidence.push({ checkItemId, path: file, reason: 'file_missing' });
          if (params.warn) log.warn(`terminal evidence not readable: ${(error as Error).message}`);
          continue;
        }
        const metadata = {
          ...(input.comparison ? { comparison: input.comparison } : {}),
          terminal: bundle.metadata,
        };
        present.push({ metadata, type: 'terminal' });
        evidence.push({
          checkResultId: resultId,
          content: bundle.transcript,
          createdAt,
          description: input.description?.trim() || terminalEvidenceDescription(bundle.metadata),
          fileHeight: null,
          fileName: null,
          fileUrl: null,
          fileWidth: null,
          id: localEvidenceId(acceptanceId, dir, checkItemId, position),
          metadata,
          type: 'terminal',
        });
        continue;
      }
      const type = evidenceTypeForFile(file);
      // The metadata the server stores for an upload: chapters only on video.
      const metadata =
        input.comparison || input.chapters
          ? normalizeEvidenceMetadata(
              {
                ...(input.chapters ? { chapters: input.chapters } : {}),
                ...(input.comparison ? { comparison: input.comparison } : {}),
              },
              type,
            )
          : null;
      const content = inlineText(file, type);
      const size = type === 'screenshot' || type === 'gif' ? readImageSize(file) : null;
      present.push({ metadata, type });
      evidence.push({
        checkResultId: resultId,
        content,
        createdAt,
        description: evidenceDescriptionForFile(input.description, file) ?? null,
        fileHeight: size?.height ?? null,
        fileName: path.basename(file),
        fileUrl: content === null ? pageUrl(acceptanceDir, file) : null,
        fileWidth: size?.width ?? null,
        id: localEvidenceId(acceptanceId, dir, checkItemId, position),
        metadata: metadata ?? null,
        type,
      });
    }

    const { executionGaps, gaps } = requiredEvidenceGaps(round.plan, checkItemId, present);
    const verdict = publishedVerdictFor(result.verdict, gaps);
    publishedVerdicts.push(verdict);
    const limitation = missingEvidenceLimitation(gaps, executionGaps);
    if (gaps.length > 0) {
      missingEvidence.push({ checkItemId, types: gaps });
      if (params.warn) log.warn(`${checkItemId}: ${limitation}`);
    }
    results.push({
      checkItemId,
      checkItemIndex: index,
      checkItemTitle: String(result.checkItemTitle),
      createdAt,
      id: resultId,
      metadata: (result.metadata as LocalResultSource['metadata']) ?? null,
      required: Boolean(result.required),
      suggestion: result.suggestion,
      toulmin: gaps.length > 0 ? { ...result.toulmin, limitation } : result.toulmin,
      verdict,
    });
  }

  const unexecuted = round.plan?.filter((item) => !executed.has(item.id)) ?? [];
  for (const { item, types } of unexecutedEvidenceGaps(round.plan, executed)) {
    missingEvidence.push({ checkItemId: item.id, types });
    publishedVerdicts.push('uncertain');
    if (params.warn)
      log.warn(`${item.id}: not executed; required evidence not published: ${types.join(', ')}.`);
  }

  const result = round.result;
  const tracedCost = interactionCostFromReportDir(roundPath, result);
  const metadata = metadataForReport(
    tracedCost ? { ...result, interactionCost: tracedCost } : result,
  );
  const report = settleReport({
    allCasesCount: round.allCases.length,
    casesCount: round.cases.length,
    conclusion: round.conclusion,
    content: round.content,
    missingEvidenceCount: missingEvidence.length,
    publishedVerdicts,
    summary: round.summary,
  });

  return {
    droppedLabels: round.droppedLabels,
    failedEvidence,
    missingEvidence,
    source: {
      dir,
      evidence,
      proposal: round.proposal || null,
      report: {
        content: report.content ?? null,
        failedChecks: report.failedChecks ?? null,
        overallConfidence: report.overallConfidence ?? null,
        passedChecks: report.passedChecks ?? null,
        summary: report.summary ?? null,
        totalChecks: report.totalChecks ?? null,
        uncertainChecks: report.uncertainChecks ?? null,
        verdict: report.verdict ?? null,
      },
      results,
      run: {
        context: (round.context as VerifyRunContext | undefined) ?? null,
        createdAt,
        goal: round.goal ?? null,
        id: runId,
        metadata: (metadata as VerifyRunMetadata | undefined) ?? null,
        plan: round.plan ?? null,
        roundIndex,
        scenario: round.scenario,
        title: round.title ?? null,
      },
    },
    unexecuted: unexecuted.map((item) => item.id),
  };
}
