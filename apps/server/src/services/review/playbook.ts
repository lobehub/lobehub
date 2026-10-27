import type { DocumentReviewTextAnchor } from '@lobechat/types';

import { DocumentModel } from '@/database/models/document';
import { DocumentReviewModel } from '@/database/models/documentReview';
import type {
  DocumentReviewCheckResultItem,
  DocumentReviewRuleItem,
  DocumentReviewSessionItem,
} from '@/database/schemas/documentReview';
import type { LobeChatDatabase } from '@/database/type';

import { chainCheckPrompt, CHECK_SYSTEM_PROMPT } from './checkPrompt';
import { documentPlainText, readDocumentTextSource, replaceTextInDocument } from './documentEditor';
import { ReviewServiceError } from './errors';
import type { ReviewLlm } from './llm';
import { AiReviewLlm } from './llm';
import {
  chainProposalFromDescription,
  chainProposalFromDocument,
  PROPOSAL_SYSTEM_PROMPT,
} from './proposalPrompt';
import {
  CheckResponseSchema,
  type CheckVerdict,
  type ProposalDraft,
  ProposalDraftSchema,
  ProposalResponseSchema,
  REVIEW_CHECK_BATCH_SIZE,
  REVIEW_CHECK_MAX_CHARS,
  REVIEW_CHECK_PROMPT_VERSION,
  REVIEW_PROPOSAL_MAX_CHARS,
  REVIEW_PROPOSAL_PROMPT_VERSION,
  REVIEW_SUGGESTION_PROMPT_VERSION,
  SuggestionResponseSchema,
} from './schema';
import { chainSuggestionPrompt, SUGGESTION_SYSTEM_PROMPT } from './suggestionPrompt';
import { countQuoteOccurrences, locateQuote, quoteContext } from './textExtract';

export interface ProposedRuleDraft extends ProposalDraft {
  duplicate: boolean;
}

export interface ProposalResult {
  drafts: ProposedRuleDraft[];
  meta: {
    droppedInvalid: number;
    latencyMs: number;
    promptVersion: string;
  };
}

type CheckStatus = 'passed' | 'failed' | 'uncertain';

interface NormalizedOutcome {
  evidence: DocumentReviewTextAnchor[];
  explanation: string;
  status: CheckStatus;
}

interface RuleWithItem {
  item: DocumentReviewCheckResultItem;
  rule?: DocumentReviewRuleItem;
}

const UNCERTAIN_REASON_LABELS: Record<string, string> = {
  ambiguous_wording: '表述存在多种解释',
  insufficient_evidence: '证据不足',
  missing_attachment: '缺少必要附件',
  model_error: '模型调用失败',
  schema_invalid: '模型输出无法解析',
};

const uncertainExplanation = (explanation: string, reason: string): string =>
  `${explanation}\n（无法判断：${UNCERTAIN_REASON_LABELS[reason] ?? reason}）`;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const clampLimit = (value: number | undefined, fallback: number): number => {
  if (!value || Number.isNaN(value)) return fallback;
  return Math.min(8, Math.max(1, Math.trunc(value)));
};

/**
 * Rule-check service (Spellbook "Playbook" direction).
 *
 * It owns five operations and nothing else:
 * - propose rules from a document or a description (drafts only, never persisted here);
 * - check an existing checklist against the current document;
 * - re-check only the items the user asked for, or every `needs_recheck` item;
 * - generate a fix suggestion for a failed / uncertain item;
 * - apply a user-edited suggestion through the editor pipeline and mark the item
 *   `needs_recheck` — applying a fix is never a verification.
 *
 * Status writes stay behind `DocumentReviewModel.transitionCheck`; this service
 * never assigns `status` directly.
 */
export class ReviewPlaybookService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;
  private readonly llm: ReviewLlm;
  private readonly reviewModel: DocumentReviewModel;
  private readonly documentModel: DocumentModel;

  constructor(params: {
    db: LobeChatDatabase;
    llm?: ReviewLlm;
    userId: string;
    workspaceId?: string | null;
  }) {
    this.db = params.db;
    this.userId = params.userId;
    this.workspaceId = params.workspaceId;
    this.llm =
      params.llm ?? new AiReviewLlm(params.db, params.userId, params.workspaceId ?? undefined);
    this.reviewModel = new DocumentReviewModel(
      params.db,
      params.userId,
      params.workspaceId ?? undefined,
    );
    this.documentModel = new DocumentModel(
      params.db,
      params.userId,
      params.workspaceId ?? undefined,
    );
  }

  // ---------------------------------------------------------------------------
  // Rule proposal
  // ---------------------------------------------------------------------------

  /**
   * Propose rules from a document body or a free-form description. This method
   * never writes to the database: the caller shows the drafts, the user picks
   * and edits them, and only `createRuleSet` + `confirmRuleSet` make them real.
   */
  proposeRules = async (input: {
    description?: string;
    documentId: string;
    limit?: number;
  }): Promise<ProposalResult> => {
    const startedAt = Date.now();
    const source = await readDocumentTextSource(this.documentModel, input.documentId);
    const documentText = documentPlainText(source).slice(0, REVIEW_PROPOSAL_MAX_CHARS);
    const existingRules = await this.listExistingRules(input.documentId);
    const description = input.description?.trim();
    const isDescription = Boolean(description);
    const limit = clampLimit(input.limit, isDescription ? 4 : 6);

    const user = isDescription
      ? chainProposalFromDescription({
          description: description!,
          documentText,
          existingRules,
          limit,
        })
      : chainProposalFromDocument({ documentText, existingRules, limit });

    let raw: unknown;
    try {
      raw = await this.llm.generateObject({
        promptVersion: REVIEW_PROPOSAL_PROMPT_VERSION,
        schema: ProposalResponseSchema,
        schemaName: 'ReviewProposal',
        scenario: 'document_review_proposal',
        system: PROPOSAL_SYSTEM_PROMPT,
        user,
      });
    } catch (error) {
      throw new ReviewServiceError(
        'LLM_FAILED',
        `Rule proposal failed: the model call errored (${(error as Error).message})`,
      );
    }

    // PV1: the top-level envelope must be { drafts: unknown[] }. A batch of
    // malformed drafts is not a crash; an unreadable envelope is.
    const envelope = raw as { drafts?: unknown } | null | undefined;
    if (!envelope || typeof envelope !== 'object' || !Array.isArray(envelope.drafts)) {
      throw new ReviewServiceError(
        'SCHEMA_INVALID',
        'Rule proposal failed: the model returned no drafts array',
      );
    }

    let droppedInvalid = 0;
    const valid: ProposalDraft[] = [];
    for (const item of envelope.drafts) {
      const parsed = ProposalDraftSchema.safeParse(item); // PV2
      if (!parsed.success) {
        droppedInvalid += 1;
        continue;
      }
      valid.push(parsed.data);
    }

    const limited = valid.slice(0, limit); // PV3
    const seen = new Set(existingRules.map((rule) => rule.title.trim().toLowerCase()));
    const drafts: ProposedRuleDraft[] = limited.map((draft) => {
      // PV4: a clause quote that is not verbatim in the document is not an
      // error — downgrade the source hint to a pattern instead of dropping the
      // rule. The same applies when there is no document at all.
      let sourceHint = draft.sourceHint;
      if (sourceHint?.kind === 'clause') {
        const clauseQuote = sourceHint.quote?.trim();
        sourceHint =
          clauseQuote && documentText.includes(clauseQuote)
            ? { ...sourceHint, quote: clauseQuote }
            : { kind: 'pattern' };
      }

      // PV5: duplicate titles are flagged, not silently dropped.
      const key = draft.title.trim().toLowerCase();
      const duplicate = seen.has(key);
      seen.add(key);

      return { ...draft, duplicate, sourceHint };
    });

    return {
      drafts,
      meta: {
        droppedInvalid,
        latencyMs: Date.now() - startedAt,
        promptVersion: REVIEW_PROPOSAL_PROMPT_VERSION,
      },
    };
  };

  private listExistingRules = async (documentId: string) => {
    const ruleSets = await this.reviewModel.listRuleSets(documentId);
    const rules: Array<{ instruction: string; title: string }> = [];
    for (const ruleSet of ruleSets) {
      const setRules = await this.reviewModel.listRules(ruleSet.id);
      for (const rule of setRules) rules.push({ instruction: rule.instruction, title: rule.title });
    }
    return rules.slice(0, 60);
  };

  // ---------------------------------------------------------------------------
  // Checks
  // ---------------------------------------------------------------------------

  /** Check every `unchecked` item (or exactly the requested unchecked items). */
  runChecks = async (input: {
    checkResultIds?: string[];
    sessionId: string;
    userContext?: string;
  }): Promise<DocumentReviewCheckResultItem[]> => {
    const { session, results } = await this.loadChecklist(input.sessionId);
    const targets = this.pickTargets(results, input.checkResultIds, ['unchecked']);
    return this.evaluate(session, targets, input.userContext);
  };

  /**
   * Re-check `needs_recheck` items only. Passing explicit ids that are not
   * currently awaiting re-check is rejected rather than silently re-judged.
   */
  recheckChecks = async (input: {
    checkResultIds?: string[];
    sessionId: string;
    userContext?: string;
  }): Promise<DocumentReviewCheckResultItem[]> => {
    const { session, results } = await this.loadChecklist(input.sessionId);
    const targets = this.pickTargets(results, input.checkResultIds, ['needs_recheck']);
    return this.evaluate(session, targets, input.userContext);
  };

  private loadChecklist = async (
    sessionId: string,
  ): Promise<{
    results: DocumentReviewCheckResultItem[];
    session: DocumentReviewSessionItem;
  }> => {
    const session = await this.reviewModel.findSessionById(sessionId);
    if (!session)
      throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'Review session not found');
    if (!session.ruleSetId) {
      throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'The session has no rule set');
    }
    const ruleSet = await this.reviewModel.findRuleSetById(session.ruleSetId);
    // Only confirmed rules are executable. Editing a rule returns its set to
    // draft, so the user must re-confirm before results are judged again.
    if (!ruleSet || ruleSet.status !== 'confirmed') {
      throw new ReviewServiceError(
        'ILLEGAL_TRANSITION',
        'The rule set must be confirmed before it can be checked',
      );
    }
    const results = await this.reviewModel.listCheckResults(sessionId);
    return { results, session };
  };

  private pickTargets = (
    results: DocumentReviewCheckResultItem[],
    ids: string[] | undefined,
    allowed: Array<DocumentReviewCheckResultItem['status']>,
  ): DocumentReviewCheckResultItem[] => {
    if (!ids?.length) return results.filter((result) => allowed.includes(result.status));

    const byId = new Map(results.map((result) => [result.id, result]));
    return ids.map((id) => {
      const result = byId.get(id);
      if (!result) {
        throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', `Check result ${id} not found`);
      }
      if (!allowed.includes(result.status)) {
        throw new ReviewServiceError(
          'ILLEGAL_TRANSITION',
          `Cannot check a "${result.status}" item with this operation`,
        );
      }
      return result;
    });
  };

  private evaluate = async (
    session: DocumentReviewSessionItem,
    items: DocumentReviewCheckResultItem[],
    userContext?: string,
  ): Promise<DocumentReviewCheckResultItem[]> => {
    if (items.length === 0) return [];

    const source = await readDocumentTextSource(this.documentModel, session.documentId);
    const documentText = documentPlainText(source).slice(0, REVIEW_CHECK_MAX_CHARS);
    // Captured before the LLM call: `transitionCheck` re-reads both versions and
    // refuses to commit a verdict computed from content that has since changed.
    const documentRevision = source.updatedAt ?? undefined;

    const ruleWithItems: RuleWithItem[] = [];
    for (const item of items) {
      ruleWithItems.push({ item, rule: await this.reviewModel.findRuleById(item.ruleId) });
    }

    const outcomes = new Map<string, NormalizedOutcome>();
    for (const batch of chunk(ruleWithItems, REVIEW_CHECK_BATCH_SIZE)) {
      const promptRules = batch.map(({ item, rule }) => ({
        instruction: rule?.instruction ?? '（规则已删除，无法检查）',
        ruleId: item.ruleId,
        severity: rule?.severity ?? 'medium',
        title: rule?.title ?? '规则已删除',
      }));

      let raw: unknown;
      try {
        raw = await this.llm.generateObject({
          promptVersion: REVIEW_CHECK_PROMPT_VERSION,
          schema: CheckResponseSchema,
          schemaName: 'ReviewCheckVerdicts',
          scenario: 'document_review_check',
          system: CHECK_SYSTEM_PROMPT,
          user: chainCheckPrompt({ documentText, rules: promptRules, userContext }),
        });
      } catch {
        for (const { item } of batch) {
          outcomes.set(item.id, {
            evidence: [],
            explanation: uncertainExplanation('模型调用失败，未能完成判定。', 'model_error'),
            status: 'uncertain',
          });
        }
        continue;
      }

      const parsed = CheckResponseSchema.safeParse(raw);
      if (!parsed.success) {
        for (const { item } of batch) {
          outcomes.set(item.id, {
            evidence: [],
            explanation: uncertainExplanation('模型输出无法解析，未能完成判定。', 'schema_invalid'),
            status: 'uncertain',
          });
        }
        continue;
      }

      const verdictByRule = new Map(parsed.data.results.map((result) => [result.ruleId, result]));
      for (const { item } of batch) {
        const verdict = verdictByRule.get(item.ruleId);
        if (!verdict) {
          outcomes.set(item.id, {
            evidence: [],
            explanation: uncertainExplanation('模型未返回该规则的结论。', 'schema_invalid'),
            status: 'uncertain',
          });
          continue;
        }
        outcomes.set(item.id, this.normalizeVerdict(verdict, documentText));
      }
    }

    const updated: DocumentReviewCheckResultItem[] = [];
    for (const { item, rule } of ruleWithItems) {
      const outcome = outcomes.get(item.id)!;
      const ruleRevision = rule?.updatedAt ?? undefined;
      // The ONLY status write path: a `check` event carrying the normalized
      // outcome. `passed` therefore can never come from applying a fix.
      const row = await this.reviewModel.transitionCheck(item.id, {
        event: 'check',
        evidence: outcome.evidence,
        explanation: outcome.explanation,
        outcome: outcome.status,
        // Only assert revisions we actually read, so a caller without version
        // information keeps the previous behaviour instead of failing every check.
        expectedRevisions: {
          ...(documentRevision ? { documentUpdatedAt: documentRevision } : {}),
          ...(ruleRevision ? { ruleUpdatedAt: ruleRevision } : {}),
        },
      });
      if (row) updated.push(row);
    }
    return updated;
  };

  /**
   * Normalization (NV): a `passed` verdict without a locatable supporting quote,
   * or a `failed` verdict without a locatable violating quote, degrades to
   * `uncertain`. "Passing must be evidenced."
   */
  private normalizeVerdict = (verdict: CheckVerdict, documentText: string): NormalizedOutcome => {
    const located = verdict.evidence
      .map((evidence) => ({
        ...evidence,
        anchor: locateQuote(documentText, evidence.quote, evidence.clauseLabel),
      }))
      .filter((evidence) => evidence.anchor !== null);

    const evidence = located.map((item) => item.anchor!.anchor);
    const hasSupporting = located.some((item) => item.kind === 'supporting');
    const hasViolating = located.some((item) => item.kind === 'violating');

    if (verdict.verdict === 'passed') {
      if (!hasSupporting) {
        return {
          evidence,
          explanation: uncertainExplanation(verdict.explanation, 'insufficient_evidence'),
          status: 'uncertain',
        };
      }
      return { evidence, explanation: verdict.explanation, status: 'passed' };
    }

    if (verdict.verdict === 'failed') {
      if (!hasViolating) {
        return {
          evidence,
          explanation: uncertainExplanation(verdict.explanation, 'insufficient_evidence'),
          status: 'uncertain',
        };
      }
      return { evidence, explanation: verdict.explanation, status: 'failed' };
    }

    return {
      evidence,
      explanation: uncertainExplanation(
        verdict.explanation,
        verdict.uncertainReason ?? 'insufficient_evidence',
      ),
      status: 'uncertain',
    };
  };

  // ---------------------------------------------------------------------------
  // Suggestions
  // ---------------------------------------------------------------------------

  /** Ask the model for a replacement on a failed / uncertain item. Never writes status. */
  suggestFix = async (input: {
    checkResultId: string;
    userInstruction?: string;
  }): Promise<DocumentReviewCheckResultItem> => {
    const result = await this.reviewModel.findCheckResultById(input.checkResultId);
    if (!result) throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'Check result not found');
    if (result.status !== 'failed' && result.status !== 'uncertain') {
      throw new ReviewServiceError(
        'ILLEGAL_TRANSITION',
        `A suggestion can only be generated for a failed or uncertain item, not "${result.status}"`,
      );
    }

    const session = await this.reviewModel.findSessionById(result.sessionId);
    if (!session)
      throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'Review session not found');
    const rule = await this.reviewModel.findRuleById(result.ruleId);
    if (!rule) throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'Rule not found');

    const source = await readDocumentTextSource(this.documentModel, session.documentId);
    const documentText = documentPlainText(source);
    const target = (result.evidence ?? []).find((item) => item.quote?.trim());
    if (!target) {
      throw new ReviewServiceError(
        'NO_TARGET_TEXT',
        'The item has no located evidence text to rewrite; re-check or edit the document manually',
      );
    }

    const context = quoteContext(documentText, target.quote);
    let raw: unknown;
    try {
      raw = await this.llm.generateObject({
        promptVersion: REVIEW_SUGGESTION_PROMPT_VERSION,
        schema: SuggestionResponseSchema,
        schemaName: 'ReviewSuggestion',
        scenario: 'document_review_suggestion',
        system: SUGGESTION_SYSTEM_PROMPT,
        user: chainSuggestionPrompt({
          contextAfter: context.after,
          contextBefore: context.before,
          evidence: (result.evidence ?? []).map(({ quote }) => ({
            kind: result.status === 'failed' ? 'violating' : 'context',
            quote,
          })),
          explanation: result.explanation ?? '',
          rule,
          targetQuote: target.quote,
          userInstruction: input.userInstruction,
          verdict: result.status,
        }),
      });
    } catch {
      throw new ReviewServiceError('LLM_FAILED', 'Suggestion generation failed: the model errored');
    }

    const parsed = SuggestionResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ReviewServiceError('SCHEMA_INVALID', 'Suggestion generation returned invalid JSON');
    }

    const suggestion = parsed.data;
    if (!locateQuote(documentText, suggestion.targetQuote)) {
      throw new ReviewServiceError(
        'ANCHOR_LOST',
        'The suggested target text is not present in the document',
      );
    }
    if (suggestion.replacementText === suggestion.targetQuote) {
      throw new ReviewServiceError('NO_OP_SUGGESTION', 'The suggestion does not change the text');
    }
    const maxLength = Math.max(400, suggestion.targetQuote.length * 3);
    if (suggestion.replacementText.length > maxLength) {
      throw new ReviewServiceError(
        'SCHEMA_INVALID',
        `The suggested replacement is too long (${suggestion.replacementText.length} > ${maxLength})`,
      );
    }

    const updated = await this.reviewModel.updateSuggestion(input.checkResultId, {
      original: suggestion.targetQuote,
      replacement: suggestion.replacementText,
    });
    if (!updated) throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'Check result not found');
    return updated;
  };

  /**
   * Apply a (possibly user-edited) suggestion.
   *
   * Order matters and mirrors S2: write the document through the editor path
   * first (history + undo), then move the item to `needs_recheck`. If the write
   * fails, status is untouched. There is no code path here that can produce
   * `passed` — only `checkRun.recheck` can.
   */
  applySuggestion = async (input: {
    appliedText: string;
    checkResultId: string;
  }): Promise<DocumentReviewCheckResultItem> => {
    const result = await this.reviewModel.findCheckResultById(input.checkResultId);
    if (!result) throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'Check result not found');
    // Design X7: a suggestion exists only for a rule the check did not pass.
    // `needs_recheck` must be re-checked first — applying an edit again would
    // let the user keep mutating a document that is already awaiting a verdict.
    if (result.status !== 'failed' && result.status !== 'uncertain') {
      throw new ReviewServiceError(
        'ILLEGAL_TRANSITION',
        `Cannot apply a suggestion to a "${result.status}" item; apply is only valid for failed or uncertain`,
      );
    }

    const suggestion = result.suggestion;
    if (!suggestion?.original?.trim()) {
      throw new ReviewServiceError('SUGGESTION_NOT_FOUND', 'This item has no suggestion to apply');
    }

    const appliedText = input.appliedText?.trim();
    if (!appliedText) {
      throw new ReviewServiceError('NO_OP_SUGGESTION', 'The applied text is empty');
    }
    if (appliedText === suggestion.original) {
      throw new ReviewServiceError('NO_OP_SUGGESTION', 'The applied text is unchanged');
    }

    const session = await this.reviewModel.findSessionById(result.sessionId);
    if (!session)
      throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'Review session not found');

    const source = await readDocumentTextSource(this.documentModel, session.documentId);
    const occurrences = countQuoteOccurrences(documentPlainText(source), suggestion.original);
    if (occurrences === 0) {
      throw new ReviewServiceError(
        'ANCHOR_LOST',
        'The suggestion original text is no longer present in the document',
      );
    }
    if (occurrences > 1) {
      throw new ReviewServiceError(
        'ANCHOR_AMBIGUOUS',
        'The suggestion original text occurs more than once; edit the document to disambiguate it',
      );
    }

    // Write the document first. A failure here leaves the checklist untouched.
    await replaceTextInDocument({
      db: this.db,
      documentId: session.documentId,
      newText: appliedText,
      searchText: suggestion.original,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    const updated = await this.reviewModel.transitionCheck(input.checkResultId, {
      event: 'apply_suggestion',
      suggestion: { original: suggestion.original, replacement: appliedText },
    });
    if (!updated) throw new ReviewServiceError('CHECK_RESULT_NOT_FOUND', 'Check result not found');
    if (updated.status !== 'needs_recheck') {
      throw new Error(
        `Invariant violated: applying a suggestion produced "${updated.status}" instead of needs_recheck`,
      );
    }

    return updated;
  };
}
