import type {
  DocumentReviewCheckResultItem,
  DocumentReviewImpactItem,
  DocumentReviewRuleItem,
  DocumentReviewRuleSetItem,
  DocumentReviewSessionItem,
} from '@lobechat/database/schemas';
import type {
  DocumentReviewCheckSuggestion,
  DocumentReviewImpactCategory,
  DocumentReviewImpactKind,
  DocumentReviewRuleInput,
  DocumentReviewTextAnchor,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface DocumentReviewRuleSetWithRules extends DocumentReviewRuleSetItem {
  rules: DocumentReviewRuleItem[];
}

export interface DocumentReviewSessionDetail {
  checkResults: DocumentReviewCheckResultItem[];
  impacts: DocumentReviewImpactItem[];
  ruleSet: DocumentReviewRuleSetWithRules | null;
  session: DocumentReviewSessionItem;
}

export interface ProposedRuleDraft {
  /** The agent flagged a rule with the same title/instruction already in the set. */
  duplicate: boolean;
  instruction: string;
  rationale: string;
  severity: 'high' | 'low' | 'medium';
  sourceHint: {
    clauseLabel?: string;
    kind: 'clause' | 'pattern';
    quote?: string;
  } | null;
  title: string;
}

export interface ProposeRulesResult {
  drafts: ProposedRuleDraft[];
  meta: {
    droppedInvalid: number;
    latencyMs: number;
    promptVersion: string;
  };
}

export interface TextDiffBlock {
  /** Current wording of the block; empty for a pure deletion. */
  after: string;
  /** Baseline wording of the block; empty for a pure insertion. */
  before: string;
  index: number;
}

export interface AnalyzeImpactsResult {
  baseline: { historyId: string; savedAt: Date };
  diff: { addedChars: number; blocks: TextDiffBlock[]; removedChars: number };
  /** Number of change blocks the analysis skipped before prompting the model. */
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
  messages: Array<{ content: string; role: 'system' | 'user' }>;
  related: { after: string; anchor: DocumentReviewTextAnchor; before: string } | null;
  source: { after: string; anchor: DocumentReviewTextAnchor; before: string };
}

export interface ReviewServiceError extends Error {
  code?: string;
}

/**
 * Client API for document review (change-impact analysis + rule checklist).
 *
 * Every call maps 1:1 onto the `documentReview` tRPC router; components and
 * hooks never touch `lambdaClient` directly.
 */
class DocumentReviewService {
  listSessions = (documentId: string): Promise<DocumentReviewSessionItem[]> =>
    lambdaClient.documentReview.listSessions.query({ documentId });

  getSession = (sessionId: string): Promise<DocumentReviewSessionDetail> =>
    lambdaClient.documentReview.getSession.query({ sessionId });

  createSession = (params: {
    baseHistoryId?: string | null;
    documentId: string;
    ruleSetId?: string | null;
    title?: string | null;
  }): Promise<DocumentReviewSessionItem> =>
    lambdaClient.documentReview.createSession.mutate(params);

  deleteSession = (sessionId: string): Promise<{ deleted: boolean }> =>
    lambdaClient.documentReview.deleteSession.mutate({ sessionId });

  updateSession = (params: {
    baseHistoryId?: string | null;
    ruleSetId?: string | null;
    sessionId: string;
  }): Promise<DocumentReviewSessionItem> =>
    lambdaClient.documentReview.updateSession.mutate(params);

  listImpacts = (sessionId: string): Promise<DocumentReviewImpactItem[]> =>
    lambdaClient.documentReview.listImpacts.query({ sessionId });

  analyzeImpacts = (params: {
    baseHistoryId?: string | null;
    sessionId: string;
  }): Promise<AnalyzeImpactsResult> => lambdaClient.documentReview.analyzeImpacts.mutate(params);

  getImpactFollowUpContext = (params: {
    impactId: string;
    question?: string;
  }): Promise<ImpactFollowUpContext> =>
    lambdaClient.documentReview.getImpactFollowUpContext.query(params);

  listRuleSets = (documentId: string): Promise<DocumentReviewRuleSetItem[]> =>
    lambdaClient.documentReview.listRuleSets.query({ documentId });

  getRuleSet = (ruleSetId: string): Promise<DocumentReviewRuleSetWithRules> =>
    lambdaClient.documentReview.getRuleSet.query({ ruleSetId });

  createRuleSet = async (params: {
    description?: string | null;
    documentId: string;
    rules?: DocumentReviewRuleInput[];
    title: string;
  }): Promise<DocumentReviewRuleSetWithRules> => {
    const created = await lambdaClient.documentReview.createRuleSet.mutate(params);
    if (!created) throw new Error('createRuleSet returned no rule set');
    return created;
  };

  updateRuleSet = (params: {
    description?: string | null;
    ruleSetId: string;
    title?: string;
  }): Promise<DocumentReviewRuleSetItem | undefined> =>
    lambdaClient.documentReview.updateRuleSet.mutate(params);

  deleteRuleSet = (ruleSetId: string): Promise<{ deleted: boolean }> =>
    lambdaClient.documentReview.deleteRuleSet.mutate({ ruleSetId });

  confirmRuleSet = (ruleSetId: string): Promise<DocumentReviewRuleSetWithRules | undefined> =>
    lambdaClient.documentReview.confirmRuleSet.mutate({ ruleSetId });

  addRule = (
    params: DocumentReviewRuleInput & { ruleSetId: string },
  ): Promise<DocumentReviewRuleItem> => lambdaClient.documentReview.addRule.mutate(params);

  removeRule = (ruleId: string): Promise<{ deleted: boolean }> =>
    lambdaClient.documentReview.removeRule.mutate({ ruleId });

  initializeChecks = (sessionId: string): Promise<DocumentReviewCheckResultItem[]> =>
    lambdaClient.documentReview.initializeChecks.mutate({ sessionId });

  listCheckResults = (sessionId: string): Promise<DocumentReviewCheckResultItem[]> =>
    lambdaClient.documentReview.listCheckResults.query({ sessionId });

  updateSuggestion = (
    checkResultId: string,
    suggestion: DocumentReviewCheckSuggestion | null,
  ): Promise<DocumentReviewCheckResultItem | undefined> =>
    lambdaClient.documentReview.updateSuggestion.mutate({ checkResultId, suggestion });

  proposeRules = (params: {
    description?: string;
    documentId: string;
    limit?: number;
  }): Promise<ProposeRulesResult> => lambdaClient.documentReview.proposeRules.mutate(params);

  runChecks = (params: {
    checkResultIds?: string[];
    sessionId: string;
    userContext?: string;
  }): Promise<DocumentReviewCheckResultItem[]> =>
    lambdaClient.documentReview.runChecks.mutate(params);

  recheckChecks = (params: {
    checkResultIds?: string[];
    sessionId: string;
    userContext?: string;
  }): Promise<DocumentReviewCheckResultItem[]> =>
    lambdaClient.documentReview.recheckChecks.mutate(params);

  suggestFix = (params: {
    checkResultId: string;
    userInstruction?: string;
  }): Promise<DocumentReviewCheckResultItem> =>
    lambdaClient.documentReview.suggestFix.mutate(params);

  applySuggestion = (params: {
    appliedText: string;
    checkResultId: string;
  }): Promise<DocumentReviewCheckResultItem> =>
    lambdaClient.documentReview.applySuggestion.mutate(params);
}

export const documentReviewService = new DocumentReviewService();

export type {
  DocumentReviewCheckResultItem,
  DocumentReviewImpactCategory,
  DocumentReviewImpactItem,
  DocumentReviewImpactKind,
  DocumentReviewRuleItem,
  DocumentReviewRuleSetItem,
  DocumentReviewSessionItem,
};
