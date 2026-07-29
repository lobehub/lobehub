import debug from 'debug';

import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyReportModel } from '@/database/models/verifyReport';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { buildReportPrompt, type JudgeEvidence } from './prompts';
import { countStats, meanConfidence, rollupVerdict } from './reportRollup';
import { REPORT_NARRATIVE_JSON_SCHEMA, ReportNarrativeSchema } from './schema';

const log = debug('lobe-server:verify-reporter');

export interface GenerateReportParams {
  deliverable: string;
  goal: string;
  modelConfig: { model: string; provider: string };
  /** The verification session to summarize (the canonical run-anchor). */
  verifyRunId: string;
}

/**
 * Builds the LLM-authored verify report (a generated artifact) for a
 * verification session. The verdict and statistics are computed deterministically
 * from the session's results here; only the `summary` / `content` narrative comes
 * from the model, so the card can never contradict the rollup. Upserts per run
 * (regenerating overwrites in place).
 *
 * This is the server-side LLM reporter — distinct from `verify.upsertReport`,
 * which lets a standalone harness write a report it computed itself.
 */
export class VerifyReporterService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly resultModel: VerifyCheckResultModel;
  private readonly evidenceModel: VerifyEvidenceModel;
  private readonly reportModel: VerifyReportModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
    this.evidenceModel = new VerifyEvidenceModel(db, userId, workspaceId);
    this.reportModel = new VerifyReportModel(db, userId, workspaceId);
  }

  async generateReport(params: GenerateReportParams) {
    const { verifyRunId, goal, deliverable, modelConfig } = params;

    const results = await this.resultModel.listByRun(verifyRunId);
    if (results.length === 0) {
      log('generateReport: no results for run %s, skipping', verifyRunId);
      return null;
    }

    const evidenceRows = await this.evidenceModel.listByRun(verifyRunId);
    const evidenceByItem = new Map<string, JudgeEvidence[]>();
    for (const row of evidenceRows) {
      const list = evidenceByItem.get(row.checkItemId) ?? [];
      list.push({ content: row.content, description: row.description, type: row.type });
      evidenceByItem.set(row.checkItemId, list);
    }

    const verdict = rollupVerdict(results);
    const stats = countStats(results);

    const { system, user } = buildReportPrompt({
      deliverable,
      goal,
      items: results.map((r) => ({
        confidence: r.confidence,
        evidence: evidenceByItem.get(r.checkItemId),
        reasoning: r.toulmin?.reasoning,
        status: r.status,
        suggestion: r.suggestion,
        title: r.checkItemTitle,
        verdict: r.verdict,
      })),
      stats,
      verdict,
    });

    const narrative = await this.buildNarrative(system, user, modelConfig);

    return this.reportModel.upsertByRun({
      content: narrative?.content ?? null,
      failedChecks: stats.failed,
      generatedBy: modelConfig.model,
      overallConfidence: meanConfidence(results),
      passedChecks: stats.passed,
      reviewedByUser: false,
      summary: narrative?.summary ?? null,
      totalChecks: stats.total,
      uncertainChecks: stats.uncertain,
      verdict,
      verifyRunId,
    });
  }

  /** Generate the narrative, degrading to no prose (stats-only card) on failure. */
  private async buildNarrative(
    system: string,
    user: string,
    modelConfig: { model: string; provider: string },
  ) {
    try {
      const ai = new AiGenerationService(this.db, this.userId);
      const raw = await ai.generateObject({
        messages: [
          { content: system, role: 'system' as const },
          { content: user, role: 'user' as const },
        ],
        model: modelConfig.model,
        provider: modelConfig.provider,
        schema: REPORT_NARRATIVE_JSON_SCHEMA,
      });
      const parsed = ReportNarrativeSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch (error) {
      log('report narrative generation failed (non-fatal): %O', error);
      return null;
    }
  }
}
