import { describe, expect, it } from 'vitest';

import { hasDuplicateModelId } from '../utils';

describe('hasDuplicateModelId', () => {
  it('should detect an existing model id', () => {
    expect(hasDuplicateModelId('claude-opus-4-8', ['claude-opus-4-8'])).toBe(true);
  });

  it('should ignore empty model ids', () => {
    expect(hasDuplicateModelId('   ', ['claude-opus-4-8'])).toBe(false);
  });

  it('should allow a different model id', () => {
    expect(hasDuplicateModelId('claude-sonnet-4-6', ['claude-opus-4-8'])).toBe(false);
  });
});
