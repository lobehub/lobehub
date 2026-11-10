import { describe, expect, it } from 'vitest';

import type { AgentDocumentWithRules } from '../../types';
import { DocumentLoadPosition, DocumentLoadRule, PolicyLoad } from '../../types';
import { matchesLoadRules } from '../loadPolicy';
import { parseLoadRules, resolveDocumentLoadPosition, sortByLoadRulePriority } from '../loadRule';
import { composeToolPolicyUpdate } from '../policy';

describe('matchesLoadRules guards', () => {
  it('rejects by-keywords without keywords or without a user message', () => {
    expect(
      matchesLoadRules({ loadRules: { rule: 'by-keywords' } }, { currentUserMessage: 'hello' }),
    ).toBe(false);
    expect(
      matchesLoadRules(
        { loadRules: { keywords: ['', ''], rule: 'by-keywords' } },
        {
          currentUserMessage: 'hello',
        },
      ),
    ).toBe(false);
    expect(matchesLoadRules({ loadRules: { keywords: ['hello'], rule: 'by-keywords' } }, {})).toBe(
      false,
    );
  });

  it('rejects by-regexp without a pattern', () => {
    expect(
      matchesLoadRules({ loadRules: { rule: 'by-regexp' } }, { currentUserMessage: 'anything' }),
    ).toBe(false);
  });

  it('treats missing time-range bounds as open-ended and defaults to the current time', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    expect(matchesLoadRules({ loadRules: { rule: 'by-time-range' } }, {})).toBe(true);
    expect(
      matchesLoadRules({ loadRules: { rule: 'by-time-range', timeRange: { to: future } } }, {}),
    ).toBe(true);
    expect(
      matchesLoadRules({ loadRules: { rule: 'by-time-range', timeRange: { from: past } } }, {}),
    ).toBe(true);
    expect(
      matchesLoadRules({ loadRules: { rule: 'by-time-range', timeRange: { from: future } } }, {}),
    ).toBe(false);
  });
});

describe('loadRule guards', () => {
  it('parses load rules from a document without a policy', () => {
    expect(parseLoadRules({ policy: null, policyLoadRule: DocumentLoadRule.BY_REGEXP })).toEqual({
      keywordMatchMode: undefined,
      keywords: undefined,
      maxTokens: undefined,
      priority: undefined,
      regexp: undefined,
      rule: DocumentLoadRule.BY_REGEXP,
      timeRange: undefined,
    });
  });

  it('defaults to the always rule when neither policy nor column carries one', () => {
    expect(parseLoadRules({ policy: { context: {} }, policyLoadRule: null as any }).rule).toBe(
      DocumentLoadRule.ALWAYS,
    );
  });

  it('defaults the load position when policy and column are both empty', () => {
    expect(resolveDocumentLoadPosition({ policy: null, policyLoadPosition: '' })).toBe(
      DocumentLoadPosition.BEFORE_FIRST_USER,
    );
  });

  it('sorts documents without a priority after prioritized ones', () => {
    const doc = (id: string, priority?: number) =>
      ({
        id,
        loadRules: priority === undefined ? undefined : { priority },
      }) as AgentDocumentWithRules;

    const sorted = sortByLoadRulePriority([doc('none'), doc('high', 1), doc('low', 1000)]);

    expect(sorted.map((item) => item.id)).toEqual(['high', 'none', 'low']);
  });
});

describe('composeToolPolicyUpdate guards', () => {
  it('defaults the rule to always when neither the update nor the policy sets one', () => {
    const result = composeToolPolicyUpdate(null, {});

    expect(result.policyLoadRule).toBe(DocumentLoadRule.ALWAYS);
    expect(result.policy.context?.rule).toBe(DocumentLoadRule.ALWAYS);
    expect(result.policyLoad).toBe(PolicyLoad.ALWAYS);
  });
});
