import { describe, expect, it } from 'vitest';

import { formatTaskModel, toCreateModelConfig, toModelConfigPatch } from './model';

describe('toCreateModelConfig', () => {
  it('sends only the flags given', () => {
    expect(toCreateModelConfig({})).toBeUndefined();
    expect(toCreateModelConfig({ model: 'deepseek-flash' })).toEqual({ model: 'deepseek-flash' });
    expect(toCreateModelConfig({ model: 'deepseek-flash', provider: 'lobehub' })).toEqual({
      model: 'deepseek-flash',
      provider: 'lobehub',
    });
  });

  it('treats "null" on create as no override', () => {
    expect(toCreateModelConfig({ model: 'null' })).toBeUndefined();
  });

  it('refuses --provider without --model', () => {
    expect(() => toCreateModelConfig({ provider: 'lobehub' })).toThrow(
      '--provider requires --model',
    );
  });
});

describe('toModelConfigPatch', () => {
  it('clears model and provider for --model null or none', () => {
    expect(toModelConfigPatch({ model: 'null' })).toEqual({ model: null, provider: null });
    expect(toModelConfigPatch({ model: 'NONE' })).toEqual({ model: null, provider: null });
  });

  it('drops the stored provider for a model-only edit', () => {
    expect(toModelConfigPatch({ model: 'gpt-5' })).toEqual({ model: 'gpt-5', provider: null });
  });

  it('patches the pair or the provider alone', () => {
    expect(toModelConfigPatch({ model: 'gpt-5', provider: 'openai' })).toEqual({
      model: 'gpt-5',
      provider: 'openai',
    });
    expect(toModelConfigPatch({ provider: 'openai' })).toEqual({ provider: 'openai' });
    expect(toModelConfigPatch({})).toBeUndefined();
    expect(toModelConfigPatch({ model: '' })).toBeUndefined();
  });
});

describe('formatTaskModel', () => {
  it('says the task follows its agent when no model is stored', () => {
    expect(formatTaskModel({})).toBe('follows assignee agent');
    expect(formatTaskModel({ model: null })).toBe('follows assignee agent');
  });

  it('labels a model that differs from the agent default as an override', () => {
    expect(
      formatTaskModel(
        { model: 'deepseek-flash', provider: 'lobehub' },
        { model: 'claude-opus', provider: 'anthropic' },
      ),
    ).toBe('lobehub/deepseek-flash (override)');
  });

  it('labels the creation snapshot as pinned to the agent default', () => {
    expect(
      formatTaskModel(
        { model: 'claude-opus', provider: 'anthropic' },
        { model: 'claude-opus', provider: 'anthropic' },
      ),
    ).toBe('anthropic/claude-opus (pinned, same as agent default)');
    expect(formatTaskModel({ model: 'claude-opus' }, null)).toBe('claude-opus (pinned)');
  });
});
