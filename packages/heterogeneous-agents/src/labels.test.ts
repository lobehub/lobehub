import { describe, expect, it } from 'vitest';

import { getHeterogeneousTypeLabel, HETEROGENEOUS_TYPE_LABELS } from './labels';

describe('heterogeneous type labels', () => {
  it('labels protocol runtimes instead of falling back to the type slug', () => {
    expect(HETEROGENEOUS_TYPE_LABELS['deepseek-harness']).toBe('DeepSeek Harness');
    expect(getHeterogeneousTypeLabel('deepseek-harness')).toBe('DeepSeek Harness');
  });
});
