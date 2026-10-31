import { describe, expect, it } from 'vitest';

import {
  describeTaskModelChange,
  toCreateTaskModelConfig,
  toTaskModelConfigPatch,
} from './taskModel';

describe('toCreateTaskModelConfig', () => {
  it('keeps explicit values only', () => {
    expect(toCreateTaskModelConfig({ model: ' gpt-5 ', provider: 'openai' })).toEqual({
      model: 'gpt-5',
      provider: 'openai',
    });
    expect(toCreateTaskModelConfig({ model: 'gpt-5' })).toEqual({ model: 'gpt-5' });
  });

  it('omits config for blank, "null" or missing values', () => {
    expect(toCreateTaskModelConfig({})).toBeUndefined();
    expect(toCreateTaskModelConfig({ model: '', provider: 'null' })).toBeUndefined();
    expect(toCreateTaskModelConfig({ model: null, provider: null })).toBeUndefined();
  });

  it('refuses a provider without a model instead of pairing it with the agent model', () => {
    expect(() => toCreateTaskModelConfig({ provider: 'openai' })).toThrow('provider needs model');
  });
});

describe('toTaskModelConfigPatch', () => {
  it('returns nothing when neither field is passed', () => {
    expect(toTaskModelConfigPatch({})).toBeUndefined();
  });

  it('clears both keys when the model is cleared', () => {
    expect(toTaskModelConfigPatch({ model: null })).toEqual({ model: null, provider: null });
    expect(toTaskModelConfigPatch({ model: 'null', provider: 'openai' })).toEqual({
      model: null,
      provider: null,
    });
  });

  it('drops the stored provider for a model-only change', () => {
    expect(toTaskModelConfigPatch({ model: 'gpt-5' })).toEqual({ model: 'gpt-5', provider: null });
  });

  it('sets the pair, or the provider alone', () => {
    expect(toTaskModelConfigPatch({ model: 'gpt-5', provider: 'openai' })).toEqual({
      model: 'gpt-5',
      provider: 'openai',
    });
    expect(toTaskModelConfigPatch({ provider: 'openai' })).toEqual({ provider: 'openai' });
    expect(toTaskModelConfigPatch({ provider: null })).toEqual({ provider: null });
  });

  // Models fill optional fields with "": a rename must not wipe the task model.
  it('treats blank strings as not passed', () => {
    expect(toTaskModelConfigPatch({ model: '', provider: '' })).toBeUndefined();
    expect(toTaskModelConfigPatch({ model: ' ' })).toBeUndefined();
  });
});

describe('describeTaskModelChange', () => {
  it('summarizes each patch shape', () => {
    expect(describeTaskModelChange({ model: null, provider: null })).toContain('cleared');
    expect(describeTaskModelChange({ model: 'gpt-5', provider: 'openai' })).toBe(
      'model → openai/gpt-5',
    );
    expect(describeTaskModelChange({ model: 'gpt-5', provider: null })).toBe('model → gpt-5');
    expect(describeTaskModelChange({ provider: 'openai' })).toBe('provider → openai');
  });
});
