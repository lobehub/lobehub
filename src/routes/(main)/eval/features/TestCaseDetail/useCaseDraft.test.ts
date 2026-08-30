import { describe, expect, it } from 'vitest';

import { type CaseDraft, diffCaseDraft } from './useCaseDraft';

const base: CaseDraft = { criteria: 'c', expected: 'e', input: 'i' };

describe('diffCaseDraft', () => {
  it('sends nothing when nothing changed', () => {
    expect(diffCaseDraft(base, { ...base })).toBeNull();
  });

  it('sends only the changed content field', () => {
    expect(diffCaseDraft(base, { ...base, input: 'i2' })).toEqual({ content: { input: 'i2' } });
  });

  it('sends criteria under evalConfig, not content', () => {
    expect(diffCaseDraft(base, { ...base, criteria: 'c2' })).toEqual({
      evalConfig: { criteria: 'c2' },
    });
  });

  it('combines content and evalConfig changes into one patch', () => {
    expect(diffCaseDraft(base, { criteria: 'c2', expected: 'e2', input: 'i' })).toEqual({
      content: { expected: 'e2' },
      evalConfig: { criteria: 'c2' },
    });
  });

  // A captured case has no expected answer on purpose. Clearing the field has to
  // reach the server as an empty string, not be dropped as "unchanged".
  it('treats clearing a field as a change', () => {
    expect(diffCaseDraft(base, { ...base, expected: '' })).toEqual({ content: { expected: '' } });
  });

  it('does not resurrect a field that was empty and stayed empty', () => {
    const empty: CaseDraft = { criteria: '', expected: '', input: 'i' };
    expect(diffCaseDraft(empty, { ...empty })).toBeNull();
  });
});
