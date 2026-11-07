import type {
  DocumentReviewCheckStatus,
  DocumentReviewImpactCategory,
  DocumentReviewImpactKind,
} from '@lobechat/types';

import type {
  DocumentReviewCheckResultItem,
  DocumentReviewImpactItem,
  DocumentReviewRuleItem,
} from '@/services/documentReview';

import type { ImpactGroup, ReviewCheckEntry, ReviewErrorType } from './types';
import { REVIEW_CHECK_STATUS_DISPLAY } from './types';

export const IMPACT_CATEGORY_ORDER: DocumentReviewImpactCategory[] = ['textual', 'semantic'];

export const IMPACT_KIND_LABEL_KEY: Record<DocumentReviewImpactKind, string> = {
  definition: 'pageEditor.review.impact.kind.definition',
  obligation: 'pageEditor.review.impact.kind.obligation',
  reference: 'pageEditor.review.impact.kind.reference',
  related_clause: 'pageEditor.review.impact.kind.related_clause',
};

/**
 * Impacts are shown as two groups, in this order: what changed on the page,
 * then what the change may silently affect elsewhere. An empty group is dropped
 * by the panel, never rendered as a blank heading.
 */
export const groupImpacts = (impacts: DocumentReviewImpactItem[]): ImpactGroup[] =>
  IMPACT_CATEGORY_ORDER.map((category) => ({
    category,
    items: impacts.filter((impact) => impact.category === category),
  })).filter((group) => group.items.length > 0);

export type CheckStatusCounts = Record<DocumentReviewCheckStatus | 'all', number>;

const emptyCounts = (): CheckStatusCounts => ({
  all: 0,
  failed: 0,
  needs_recheck: 0,
  passed: 0,
  uncertain: 0,
  unchecked: 0,
});

/**
 * Counts for the filter row and the tab badge. They are computed from the
 * checklist entries, not from stored results: a rule that has never been checked
 * has no result row, and the reader still expects "Not checked 3" rather than a
 * misleading zero.
 */
export const countCheckEntries = (
  entries: ReviewCheckEntry[],
  statusOf: (entry: ReviewCheckEntry) => DocumentReviewCheckStatus,
): CheckStatusCounts => {
  const counts = emptyCounts();
  counts.all = entries.length;
  for (const entry of entries) counts[statusOf(entry)] += 1;
  return counts;
};

export const countCheckStatuses = (results: DocumentReviewCheckResultItem[]): CheckStatusCounts => {
  const counts = emptyCounts();
  counts.all = results.length;
  for (const result of results) counts[result.status] += 1;
  return counts;
};

/**
 * The checklist is driven by the rule set's order, so editing a rule does not
 * reorder the list. A result whose rule was deleted still renders (with a
 * "deleted rule" fallback) instead of vanishing from the counts.
 */
export const buildCheckEntries = (
  results: DocumentReviewCheckResultItem[],
  rules: DocumentReviewRuleItem[],
): ReviewCheckEntry[] => {
  const resultByRule = new Map(results.map((result) => [result.ruleId, result]));
  const knownRuleIds = new Set(rules.map((rule) => rule.id));
  const ordered: ReviewCheckEntry[] = rules.map((rule) => ({
    result: resultByRule.get(rule.id),
    rule,
  }));

  const orphans = results
    .filter((result) => !knownRuleIds.has(result.ruleId))
    .map((result) => ({ result }));

  return [...ordered, ...orphans];
};

export const filterCheckEntries = (
  entries: ReviewCheckEntry[],
  filter: 'all' | DocumentReviewCheckStatus,
  statusOf: (entry: ReviewCheckEntry) => DocumentReviewCheckStatus,
): ReviewCheckEntry[] =>
  filter === 'all' ? entries : entries.filter((entry) => statusOf(entry) === filter);

/** The status a row should paint, with an applied fix taking effect immediately. */
export const resolveCheckStatus = (
  entry: ReviewCheckEntry,
  overrides: Record<string, DocumentReviewCheckStatus>,
): DocumentReviewCheckStatus => {
  if (!entry.result) return 'unchecked';
  return overrides[entry.result.id] ?? entry.result.status;
};

export const getStatusLabelKey = (status: DocumentReviewCheckStatus) =>
  `pageEditor.review.check.status.${status}`;

export const getSeverityLabelKey = (severity?: string | null) =>
  `pageEditor.review.check.severity.${severity ?? 'medium'}`;

export const CHECK_STATUS_TONE: Record<
  DocumentReviewCheckStatus,
  'danger' | 'info' | 'secondary' | 'success' | 'warning'
> = {
  failed: 'danger',
  needs_recheck: 'info',
  passed: 'success',
  uncertain: 'warning',
  unchecked: 'secondary',
};

export const statusFilters = (counts: CheckStatusCounts) =>
  REVIEW_CHECK_STATUS_DISPLAY.map((status) => ({ count: counts[status], status }));

export const formatConfidence = (confidence?: number | null) =>
  typeof confidence === 'number' ? `${Math.round(confidence * 100)}%` : null;

const TRPC_ERROR_CODES: Record<string, ReviewErrorType> = {
  BAD_GATEWAY: 'model',
  CONFLICT: 'conflict',
  FORBIDDEN: 'forbidden',
  INTERNAL_SERVER_ERROR: 'model',
  NOT_FOUND: 'notFound',
  PRECONDITION_FAILED: 'generic',
  UNAUTHORIZED: 'forbidden',
};

const messageOf = (error: unknown): string => {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { message?: unknown; shape?: { message?: unknown } };
  if (typeof candidate.message === 'string') return candidate.message;
  return typeof candidate.shape?.message === 'string' ? candidate.shape.message : '';
};

/**
 * Map a failed action to one message. The router keeps its domain codes on the
 * server, so the client classifies by tRPC code plus the two outcomes whose
 * product meaning is unambiguous: "nothing changed" and "no earlier version".
 */
export const classifyReviewError = (error: unknown): ReviewErrorType => {
  const message = messageOf(error);

  if (/没有文字差异|no textual difference/i.test(message)) return 'noDiff';
  if (/基线|baseline/i.test(message)) return 'noBaseline';
  if (/找不到|定位|anchor lost/i.test(message)) return 'anchorLost';

  const code =
    (error as { data?: { code?: string } })?.data?.code ??
    (error as { shape?: { data?: { code?: string } } })?.shape?.data?.code;

  return (code && TRPC_ERROR_CODES[code]) || 'generic';
};

/**
 * The impact follow-up travels into Copilot as one context chip: the changed
 * sentence, the affected sentence and why the agent flagged them. The reader
 * still writes the question, so the chip never sends an answer on their behalf.
 */
export const buildImpactFollowUpText = (params: {
  impact: DocumentReviewImpactItem;
  relatedQuote?: string;
  sourceQuote?: string;
}) => {
  const lines = [params.impact.title];
  if (params.sourceQuote) lines.push(`Changed text: ${params.sourceQuote}`);
  if (params.relatedQuote) lines.push(`Related text: ${params.relatedQuote}`);
  if (params.impact.reason) lines.push(`Why it matters: ${params.impact.reason}`);
  return lines.join('\n');
};
