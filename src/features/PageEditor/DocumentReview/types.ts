import type { DocumentReviewCheckStatus } from '@lobechat/types';

import type {
  DocumentReviewCheckResultItem,
  DocumentReviewImpactItem,
  DocumentReviewRuleItem,
} from '@/services/documentReview';

export type ReviewTab = 'impacts' | 'rules';

export type ReviewCheckFilter = 'all' | DocumentReviewCheckStatus;

/** Order matters: what needs the reader's attention comes first. */
export const REVIEW_CHECK_STATUS_DISPLAY: DocumentReviewCheckStatus[] = [
  'failed',
  'needs_recheck',
  'uncertain',
  'unchecked',
  'passed',
];

/** How a failed / uncertain / re-checkable item earns an inline action. */
export const REVIEW_CHECK_ACTIONABLE: DocumentReviewCheckStatus[] = ['failed', 'uncertain'];

export interface ReviewCheckEntry {
  result?: DocumentReviewCheckResultItem;
  rule?: DocumentReviewRuleItem;
}

export interface ImpactGroup {
  category: 'semantic' | 'textual';
  items: DocumentReviewImpactItem[];
}

export type ReviewErrorType =
  | 'anchorLost'
  | 'conflict'
  | 'forbidden'
  | 'generic'
  | 'model'
  | 'noBaseline'
  | 'noDiff'
  | 'notFound';

export interface ReviewActionError {
  action: ReviewAction;
  type: ReviewErrorType;
}

export type ReviewAction =
  | 'adoptRules'
  | 'analyze'
  | 'applySuggestion'
  | 'confirmRuleSet'
  | 'proposeRules'
  | 'recheck'
  | 'runChecks'
  | 'suggestFix';
