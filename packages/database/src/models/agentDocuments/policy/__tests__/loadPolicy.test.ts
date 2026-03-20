// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { matchesLoadRules, shouldInjectDocument } from '..';

describe('agentDocuments load policy checks', () => {
  it('matches by-keywords with all mode', () => {
    expect(
      matchesLoadRules(
        {
          loadRules: {
            keywordMatchMode: 'all',
            keywords: ['release', 'checklist'],
            rule: 'by-keywords',
          },
        },
        { currentUserMessage: 'Prepare release checklist now' },
      ),
    ).toBe(true);

    expect(
      matchesLoadRules(
        {
          loadRules: {
            keywordMatchMode: 'all',
            keywords: ['release', 'incident'],
            rule: 'by-keywords',
          },
        },
        { currentUserMessage: 'Prepare release checklist now' },
      ),
    ).toBe(false);
  });

  it('matches by-regexp and rejects invalid regexp', () => {
    expect(
      matchesLoadRules(
        { loadRules: { regexp: '\\brelease\\b', rule: 'by-regexp' } },
        { currentUserMessage: 'release now' },
      ),
    ).toBe(true);

    expect(
      matchesLoadRules(
        { loadRules: { regexp: '[invalid', rule: 'by-regexp' } },
        { currentUserMessage: 'release now' },
      ),
    ).toBe(false);
  });

  it('matches by-time-range window', () => {
    expect(
      matchesLoadRules(
        {
          loadRules: {
            rule: 'by-time-range',
            timeRange: { from: '2026-03-13T11:00:00.000Z', to: '2026-03-13T13:00:00.000Z' },
          },
        },
        { currentTime: new Date('2026-03-13T12:00:00.000Z') },
      ),
    ).toBe(true);
  });

  it('composes load-rule check through shouldInjectDocument', () => {
    const doc = {
      loadRules: { keywords: ['release'], rule: 'by-keywords' as const },
    };

    expect(shouldInjectDocument(doc, { currentUserMessage: 'Please release notes' })).toBe(true);

    expect(shouldInjectDocument(doc, { currentUserMessage: 'Please draft notes' })).toBe(false);
  });
});
