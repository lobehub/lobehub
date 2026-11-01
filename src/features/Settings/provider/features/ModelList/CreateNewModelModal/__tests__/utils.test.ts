import { describe, expect, it } from 'vitest';

import { CUSTOM_MODEL_TYPES, hasDuplicateModelId } from '../utils';

describe('CUSTOM_MODEL_TYPES', () => {
  it('should not offer image or video, which require a parameters schema', () => {
    expect(CUSTOM_MODEL_TYPES).not.toContain('image');
    expect(CUSTOM_MODEL_TYPES).not.toContain('video');
  });

  it('should keep the other generation types selectable', () => {
    expect(CUSTOM_MODEL_TYPES).toContain('text2music');
  });
});

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
