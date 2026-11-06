import { describe, expect, it } from 'vitest';

import { experimentContextSuffix, parseExperimentId } from './experimentNavigation';

describe('experiment case navigation', () => {
  it('keeps a generated experiment id in the previous/next case context', () => {
    const id = parseExperimentId('exp_aB09_-cdEF12');
    expect(id).toBe('exp_aB09_-cdEF12');
    expect(experimentContextSuffix(id)).toBe('?experiment=exp_aB09_-cdEF12');
  });

  it.each(['custom-experiment_42', 'exp_', 'A1'])(
    'preserves a safe caller-supplied id %s',
    (value) => {
      expect(parseExperimentId(value)).toBe(value);
      expect(new URLSearchParams(experimentContextSuffix(value)).get('experiment')).toBe(value);
    },
  );

  it('encodes query metacharacters when building a case link', () => {
    const suffix = experimentContextSuffix('custom&tab=setup');
    expect(new URLSearchParams(suffix).get('experiment')).toBe('custom&tab=setup');
    expect(new URLSearchParams(suffix).has('tab')).toBe(false);
  });

  it.each([
    null,
    '',
    ' ',
    'https://external.example',
    '//external.example',
    '../../../../settings',
    'exp_../settings',
    'exp_value&tab=setup',
    'exp_value?other=1',
    'exp_value#anchor',
    'exp_value/another',
    'exp_value\\another',
    'exp_%2e%2e',
  ])('drops invalid experiment context %j', (value) => {
    const id = parseExperimentId(value);
    expect(id).toBeUndefined();
    expect(experimentContextSuffix(id)).toBe('');
  });
});
