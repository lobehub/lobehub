import type { DocumentReviewCheckStatus } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type {
  DocumentReviewCheckResultItem,
  DocumentReviewImpactItem,
  DocumentReviewRuleItem,
} from '@/services/documentReview';

import { REVIEW_CHECK_STATUS_DISPLAY } from './types';
import {
  buildCheckEntries,
  buildImpactFollowUpText,
  classifyReviewError,
  countCheckEntries,
  countCheckStatuses,
  filterCheckEntries,
  getStatusLabelKey,
  groupImpacts,
  resolveCheckStatus,
} from './utils';

const now = new Date('2026-10-21T08:00:00.000Z');

const impact = (overrides: Partial<DocumentReviewImpactItem>): DocumentReviewImpactItem =>
  ({
    accessedAt: now,
    category: 'textual',
    confidence: 0.8,
    createdAt: now,
    id: 'imp-1',
    kind: 'definition',
    reason: 'why',
    sessionId: 'ses-1',
    severity: 'medium',
    sortOrder: 0,
    sourceAnchor: null,
    relatedAnchor: null,
    status: 'open',
    title: 'title',
    trigger: null,
    updatedAt: now,
    userId: 'user-1',
    workspaceId: 'ws-1',
    ...overrides,
  }) as DocumentReviewImpactItem;

const rule = (id: string, sortOrder: number): DocumentReviewRuleItem =>
  ({
    accessedAt: now,
    createdAt: now,
    id,
    instruction: `instruction-${id}`,
    ruleSetId: 'set-1',
    severity: 'medium',
    sortOrder,
    title: `rule-${id}`,
    updatedAt: now,
    workspaceId: 'ws-1',
  }) as DocumentReviewRuleItem;

const result = (
  id: string,
  ruleId: string,
  status: DocumentReviewCheckStatus,
): DocumentReviewCheckResultItem =>
  ({
    accessedAt: now,
    appliedAt: null,
    checkedAt: null,
    createdAt: now,
    evidence: null,
    explanation: null,
    id,
    ruleId,
    sessionId: 'ses-1',
    status,
    suggestion: null,
    updatedAt: now,
    workspaceId: 'ws-1',
  }) as DocumentReviewCheckResultItem;

describe('review panel utils', () => {
  it('groups impacts into textual then semantic and drops empty groups', () => {
    const groups = groupImpacts([
      impact({ id: 'a', category: 'semantic' }),
      impact({ id: 'b', category: 'textual' }),
      impact({ id: 'c', category: 'semantic' }),
    ]);

    expect(groups.map((group) => group.category)).toEqual(['textual', 'semantic']);
    expect(groups[0].items.map((item) => item.id)).toEqual(['b']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['a', 'c']);
    expect(groupImpacts([])).toEqual([]);
  });

  it('counts every check status, including all', () => {
    const counts = countCheckStatuses([
      result('1', 'r1', 'passed'),
      result('2', 'r2', 'failed'),
      result('3', 'r3', 'failed'),
      result('4', 'r4', 'uncertain'),
      result('5', 'r5', 'unchecked'),
      result('6', 'r6', 'needs_recheck'),
    ]);

    expect(counts).toEqual({
      all: 6,
      failed: 2,
      needs_recheck: 1,
      passed: 1,
      uncertain: 1,
      unchecked: 1,
    });
  });

  it('counts rules that have no result row as not checked', () => {
    const entries = buildCheckEntries(
      [result('res-1', 'r1', 'failed')],
      [rule('r1', 0), rule('r2', 1), rule('r3', 2)],
    );

    expect(countCheckEntries(entries, (entry) => resolveCheckStatus(entry, {}))).toEqual({
      all: 3,
      failed: 1,
      needs_recheck: 0,
      passed: 0,
      uncertain: 0,
      unchecked: 2,
    });
  });

  it('keeps the rule order and appends results whose rule was deleted', () => {
    const entries = buildCheckEntries(
      [
        result('res-2', 'r2', 'failed'),
        result('res-1', 'r1', 'passed'),
        result('orphan', 'gone', 'uncertain'),
      ],
      [rule('r2', 0), rule('r1', 1)],
    );

    expect(entries.map((entry) => entry.result?.id ?? entry.rule?.id)).toEqual([
      'res-2',
      'res-1',
      'orphan',
    ]);
    expect(entries[2].rule).toBeUndefined();
  });

  it('filters by the effective status and lets an applied fix win over stale data', () => {
    const entries = buildCheckEntries(
      [result('res-1', 'r1', 'failed'), result('res-2', 'r2', 'passed')],
      [rule('r1', 0), rule('r2', 1)],
    );

    const failOnly = filterCheckEntries(entries, 'failed', (entry) =>
      resolveCheckStatus(entry, {}),
    );
    expect(failOnly).toHaveLength(1);

    const patched = filterCheckEntries(entries, 'needs_recheck', (entry) =>
      resolveCheckStatus(entry, { 'res-1': 'needs_recheck' }),
    );
    expect(patched[0].result?.id).toBe('res-1');
  });

  it('exposes all five statuses in display order with their label keys', () => {
    expect(REVIEW_CHECK_STATUS_DISPLAY).toEqual([
      'failed',
      'needs_recheck',
      'uncertain',
      'unchecked',
      'passed',
    ]);
    expect(getStatusLabelKey('needs_recheck')).toBe('pageEditor.review.check.status.needs_recheck');
  });

  it('explains the follow-up context handed to Copilot', () => {
    const text = buildImpactFollowUpText({
      impact: impact({ title: 'Payment trigger', reason: 'It still points to final acceptance' }),
      relatedQuote: 'Payment is due after final acceptance.',
      sourceQuote: 'Acceptance happens in three stages.',
    });

    expect(text).toContain('Payment trigger');
    expect(text).toContain('Changed text: Acceptance happens in three stages.');
    expect(text).toContain('Related text: Payment is due after final acceptance.');
    expect(text).toContain('Why it matters: It still points to final acceptance');
  });

  describe('classifyReviewError', () => {
    it('recognises the two benign analysis outcomes by their message', () => {
      expect(classifyReviewError({ message: '基线与当前版本没有文字差异' })).toBe('noDiff');
      expect(classifyReviewError({ message: '基线版本正文为空，无法对比' })).toBe('noBaseline');
    });

    it('recognises a lost anchor and maps tRPC codes', () => {
      expect(classifyReviewError({ message: '找不到要替换的原文' })).toBe('anchorLost');
      expect(classifyReviewError({ data: { code: 'CONFLICT' }, message: 'x' })).toBe('conflict');
      expect(classifyReviewError({ data: { code: 'FORBIDDEN' }, message: 'x' })).toBe('forbidden');
      expect(classifyReviewError({ data: { code: 'INTERNAL_SERVER_ERROR' }, message: 'x' })).toBe(
        'model',
      );
      expect(classifyReviewError(new Error('boom'))).toBe('generic');
    });
  });
});
