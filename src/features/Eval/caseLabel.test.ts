import { describe, expect, it } from 'vitest';

import { getCaseLabel, hasCaseTitle } from './caseLabel';

describe('getCaseLabel', () => {
  it('reads the declared title first', () => {
    const testCase = {
      content: { input: 'I have been feeling tired.\nCan you look at my sleep data?' },
      metadata: { title: '  Sleep data trend  ' },
    };
    expect(getCaseLabel(testCase)).toBe('Sleep data trend');
    expect(hasCaseTitle(testCase)).toBe(true);
  });

  it('falls back to the first non-empty line of a prompt when the title is omitted', () => {
    const testCase = { content: { input: '\n  Using my saved Shopify credential\n\nsecond line' } };
    expect(getCaseLabel(testCase)).toBe('Using my saved Shopify credential');
    expect(getCaseLabel({ ...testCase, metadata: { title: '   ' } })).toBe(
      'Using my saved Shopify credential',
    );
    expect(hasCaseTitle(testCase)).toBe(false);
  });

  it('folds a JSON input onto one line instead of showing only its opening brace', () => {
    const input = JSON.stringify({ query: 'air mattress market', region: 'US' }, null, 2);
    expect(getCaseLabel({ content: { input } })).toBe(
      '{ "query": "air mattress market", "region": "US" }',
    );
    expect(getCaseLabel({ content: { input: '[\n  1,\n  2\n]' } })).toBe('[ 1, 2 ]');
  });

  it('returns an empty label for a case without content', () => {
    expect(getCaseLabel(undefined)).toBe('');
    expect(getCaseLabel({ content: null, metadata: null })).toBe('');
  });
});
