import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  chainDocumentReviewImpact,
  chainDocumentReviewImpactFollowUp,
  DOCUMENT_REVIEW_IMPACT_PROMPT_VERSION,
  DOCUMENT_REVIEW_IMPACT_SCHEMA_NAME,
} from '@lobechat/prompts';
import type { DocumentReviewImpactInput, DocumentReviewTextAnchor } from '@lobechat/types';

import type { DocumentReviewImpactItem } from '@/database/schemas/documentReview';

import type { TextDiffResult } from './diff';
import { computeTextDiff, formatDiffBlocks } from './diff';
import { DocumentImpactError } from './errors';
import type { DocumentImpactLlm } from './llm';
import type { ImpactAnalysisRepository } from './repository';
import type { ParsedImpactResponse } from './schema';
import { parseImpactAnalysisResponse } from './schema';
import type { AnchorContext } from './text';
import {
  anchorContext,
  buildAnchor,
  extractDocumentText,
  normalizeText,
  textFromEditorData,
} from './text';

/** Prompt text cap per version; longer contracts are truncated with a marker. */
export const IMPACT_PROMPT_TEXT_LIMIT = 24_000;
export const IMPACT_MAX_ITEMS = 40;

export interface AnalyzeImpactsParams {
  /** Overrides the session's stored baseline for this run and for later runs. */
  baseHistoryId?: string | null;
  sessionId: string;
}

export interface AnalyzeImpactsResult {
  baseline: { historyId: string; savedAt: Date };
  diff: TextDiffResult;
  items: DocumentReviewImpactItem[];
  stats: {
    dropped: number;
    invalidAnchors: number;
    locatedAnchors: number;
    semantic: number;
    textual: number;
  };
}

export interface ImpactFollowUpContext {
  document: { id: string; title: string };
  impact: DocumentReviewImpactItem;
  /** Ready-to-send messages: the impact item plus both original excerpts. */
  messages: Array<{ content: string; role: 'system' | 'user' }>;
  related: (AnchorContext & { anchor: DocumentReviewTextAnchor }) | null;
  source: AnchorContext & { anchor: DocumentReviewTextAnchor };
}

export interface DocumentReviewImpactServiceDeps {
  llm: DocumentImpactLlm;
  repository: ImpactAnalysisRepository;
}

const truncate = (text: string, limit = IMPACT_PROMPT_TEXT_LIMIT) =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n…（正文过长，已截断）`;

const contextText = ({ after, before, quote }: AnchorContext) => `${before}${quote}${after}`;

/**
 * A quote that cannot be found in the current body is kept, not dropped: the
 * model still saw it, and the excerpt is what lets the reviewer judge whether
 * the finding is stale or the model hallucinated. `invalid` is the marker the
 * UI uses to disable the jump.
 */
const toAnchor = (
  text: string,
  quote: string | undefined,
  label?: string,
): DocumentReviewTextAnchor | null => {
  const trimmed = quote ? normalizeText(quote) : '';
  if (!trimmed) return null;

  return (
    buildAnchor(text, trimmed, label) ??
    ({ invalid: true, label, quote: trimmed } satisfies DocumentReviewTextAnchor)
  );
};

const toImpactInput = (
  draft: ParsedImpactResponse['items'][number],
  currentText: string,
): DocumentReviewImpactInput => ({
  category: draft.category,
  confidence: draft.confidence ?? null,
  kind: draft.kind,
  reason: draft.reason,
  relatedAnchor: toAnchor(currentText, draft.relatedQuote, draft.relatedLabel),
  severity: draft.severity,
  sourceAnchor: toAnchor(currentText, draft.sourceQuote, draft.sourceLabel),
  title: draft.title,
  trigger: draft.trigger ?? null,
});

const countAnchor = (input: DocumentReviewImpactInput): { invalid: number; located: number } => {
  const anchors = [input.sourceAnchor, input.relatedAnchor].filter(
    (anchor): anchor is DocumentReviewTextAnchor => Boolean(anchor),
  );
  return {
    invalid: anchors.filter((anchor) => anchor.invalid).length,
    located: anchors.filter((anchor) => !anchor.invalid).length,
  };
};

/**
 * Server-side half of the change-impact analysis.
 *
 * Flow: baseline (a `document_histories` row) → current body → direct textual
 * diff → model → anchored impact items → persistence. Every failure mode is an
 * explicit {@link DocumentImpactError} code (no baseline, no difference, model
 * failure, off-schema output), never an empty list.
 */
export class DocumentReviewImpactService {
  private readonly llm: DocumentImpactLlm;
  private readonly repository: ImpactAnalysisRepository;

  constructor({ llm, repository }: DocumentReviewImpactServiceDeps) {
    this.llm = llm;
    this.repository = repository;
  }

  analyze = async (params: AnalyzeImpactsParams): Promise<AnalyzeImpactsResult> => {
    const session = await this.repository.loadSession(params.sessionId);
    if (!session) {
      throw new DocumentImpactError('SESSION_NOT_FOUND', '审阅会话不存在');
    }

    const baseHistoryId = params.baseHistoryId ?? session.baseHistoryId;
    if (!baseHistoryId) {
      throw new DocumentImpactError(
        'NO_BASELINE',
        '该会话尚未选择基线版本，请先选择要对比的历史版本',
        { sessionId: session.id },
      );
    }

    const [document, baseline] = await Promise.all([
      this.repository.loadDocument(session.documentId),
      this.repository.loadBaseline(session.documentId, baseHistoryId),
    ]);
    if (!document) throw new DocumentImpactError('DOCUMENT_NOT_FOUND', '文档不存在或无权限访问');
    if (!baseline) {
      throw new DocumentImpactError('BASELINE_NOT_FOUND', '基线版本不存在或不属于该文档', {
        baseHistoryId,
      });
    }

    const baselineText = textFromEditorData(baseline.editorData);
    const currentText = extractDocumentText(document);
    if (!baselineText) {
      throw new DocumentImpactError('EMPTY_BASELINE', '基线版本正文为空，无法对比', {
        baseHistoryId,
      });
    }
    if (!currentText) {
      throw new DocumentImpactError('EMPTY_DOCUMENT', '当前文档正文为空，无法对比');
    }

    const diff = computeTextDiff(baselineText, currentText);
    if (diff.blocks.length === 0) {
      throw new DocumentImpactError('NO_DIFF', '基线与当前版本没有文字差异', {
        baseHistoryId,
      });
    }

    const chain = chainDocumentReviewImpact({
      baselineText: truncate(baselineText),
      currentText: truncate(currentText),
      diff: formatDiffBlocks(diff.blocks),
      documentTitle: document.title,
    });

    const raw = await this.llm
      .generateObject({
        promptVersion: DOCUMENT_REVIEW_IMPACT_PROMPT_VERSION,
        scenario: TRACING_SCENARIOS.DocumentReviewImpact,
        schemaName: DOCUMENT_REVIEW_IMPACT_SCHEMA_NAME,
        system: chain.messages[0].content,
        user: chain.messages[1].content,
      })
      .catch((error: unknown) => {
        if (error instanceof DocumentImpactError) throw error;
        throw new DocumentImpactError('LLM_FAILED', '影响分析模型调用失败', {
          cause: error instanceof Error ? error.message : String(error),
        });
      });

    const parsed = parseImpactAnalysisResponse(raw);
    const inputs = parsed.items
      .slice(0, IMPACT_MAX_ITEMS)
      .map((draft) => toImpactInput(draft, currentText));

    const items = await this.repository.saveImpacts(session.id, inputs);
    if (baseHistoryId !== session.baseHistoryId) {
      await this.repository.setBaseline(session.id, baseHistoryId);
    }

    const counts = inputs.reduce(
      (total, input) => {
        const { invalid, located } = countAnchor(input);
        return {
          invalidAnchors: total.invalidAnchors + invalid,
          locatedAnchors: total.locatedAnchors + located,
          semantic: total.semantic + (input.category === 'semantic' ? 1 : 0),
          textual: total.textual + (input.category === 'textual' ? 1 : 0),
        };
      },
      { invalidAnchors: 0, locatedAnchors: 0, semantic: 0, textual: 0 },
    );

    return {
      baseline: { historyId: baseline.id, savedAt: baseline.savedAt },
      diff,
      items,
      stats: { ...counts, dropped: parsed.dropped },
    };
  };

  /**
   * Assemble what a follow-up question needs: the impact item plus both
   * original excerpts (triggering change and affected passage), re-located in
   * the current body when possible. Invalid anchors keep their stored quote so
   * the answer can still be grounded in what was analysed.
   */
  buildFollowUpContext = async (params: {
    impactId: string;
    question?: string;
  }): Promise<ImpactFollowUpContext> => {
    const impact = await this.repository.findImpact(params.impactId);
    if (!impact) throw new DocumentImpactError('IMPACT_NOT_FOUND', '影响项不存在');

    const session = await this.repository.loadSession(impact.sessionId);
    if (!session) throw new DocumentImpactError('SESSION_NOT_FOUND', '审阅会话不存在');

    const document = await this.repository.loadDocument(session.documentId);
    if (!document) throw new DocumentImpactError('DOCUMENT_NOT_FOUND', '文档不存在或无权限访问');

    const text = extractDocumentText(document);
    const sourceAnchor: DocumentReviewTextAnchor = impact.sourceAnchor ?? {
      label: undefined,
      quote: impact.trigger ?? impact.title,
    };
    const source = anchorContext(text, sourceAnchor);
    const related = impact.relatedAnchor
      ? { ...anchorContext(text, impact.relatedAnchor), anchor: impact.relatedAnchor }
      : null;

    const chain = chainDocumentReviewImpactFollowUp({
      documentTitle: document.title,
      impact: {
        category: impact.category,
        confidence: impact.confidence,
        kind: impact.kind,
        reason: impact.reason,
        title: impact.title,
        trigger: impact.trigger,
      },
      question: params.question,
      related: related
        ? {
            context: contextText(related),
            label: related.anchor.label,
            quote: related.quote,
            status: related.status,
          }
        : null,
      source: {
        context: contextText(source),
        label: sourceAnchor.label,
        quote: source.quote,
        status: source.status,
      },
    });

    return {
      document: { id: document.id, title: document.title },
      impact,
      messages: chain.messages,
      related,
      source: { ...source, anchor: sourceAnchor },
    };
  };
}
