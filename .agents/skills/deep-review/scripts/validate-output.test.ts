import { describe, expect, it } from 'vitest';

import { extractJsonPayload, validateOutput } from './validate-output';

const validReviewIssue = {
  core_problem: 'Because empty input is accepted, the caller reaches invalid SQL.',
  dimension: 'logic',
  fix_cost: 'low',
  fix_options: ['Reject empty input'],
  id: 'logic-1',
  issue_type: 'empty input',
  likelihood: 'high',
  location: 'src/api/user.ts:87',
  nature: 'introduced',
  need_test: true,
  severity: 'p1',
  summary: 'Empty input reaches invalid SQL.',
} as const;

describe('extractJsonPayload', () => {
  it('extracts a fenced JSON object', () => {
    expect(extractJsonPayload('```json\n{"issues":[]}\n```')).toBe('{"issues":[]}');
  });

  it('accepts an unfenced JSON object for direct CLI input', () => {
    expect(extractJsonPayload('  {"issues":[]}  ')).toBe('{"issues":[]}');
  });

  it('rejects an unclosed fence', () => {
    expect(() => extractJsonPayload('```json\n{"issues":[]}')).toThrow('JSON fence is not closed');
  });

  it('extracts one fenced payload from surrounding prose', () => {
    expect(extractJsonPayload('Result:\n```json\n{"issues":[]}\n```\nDone')).toBe('{"issues":[]}');
  });

  it('rejects multiple JSON fences', () => {
    expect(() =>
      extractJsonPayload('```json\n{"issues":[]}\n```\n```json\n{"issues":[]}\n```'),
    ).toThrow('Multiple JSON fences found');
  });
});

describe('validateOutput', () => {
  it('accepts a complete review payload', () => {
    expect(() => validateOutput('review', { issues: [validReviewIssue] })).not.toThrow();
  });

  it('rejects severity levels outside the review contract', () => {
    expect(() =>
      validateOutput('review', {
        issues: [{ ...validReviewIssue, severity: 'p3' }],
      }),
    ).toThrow();
  });

  it('requires exposed legacy findings to explain their exposure', () => {
    expect(() =>
      validateOutput('review', {
        issues: [{ ...validReviewIssue, nature: 'exposed_legacy' }],
      }),
    ).toThrow();
  });

  it('keeps verification fields specific to their verdict', () => {
    expect(() =>
      validateOutput('verify', {
        verifications: [
          {
            id: 'logic-1',
            reason: 'The input schema already rejects empty arrays.',
            verdict: 'false_positive',
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateOutput('verify', {
        verifications: [
          {
            evidence: 'This field does not belong to a false-positive verdict.',
            id: 'logic-1',
            reason: 'The input schema already rejects empty arrays.',
            verdict: 'false_positive',
          },
        ],
      }),
    ).toThrow();
  });

  it('accepts a severity correction on a confirmed finding', () => {
    expect(() =>
      validateOutput('verify', {
        verifications: [
          {
            blocks_release: false,
            can_auto_fix: true,
            evidence: 'The failure is recoverable and does not affect the main path.',
            id: 'logic-1',
            severity_override: 'p2',
            verdict: 'confirmed',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects duplicate consolidation ids', () => {
    expect(() =>
      validateOutput('consolidate', {
        same_root: [
          { id: 'style-2', same_root_as: 'ai-1' },
          { id: 'style-2', same_root_as: 'logic-1' },
        ],
      }),
    ).toThrow();
  });
});
