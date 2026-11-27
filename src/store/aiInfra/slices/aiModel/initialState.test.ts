import { describe, expect, it } from 'vitest';

import { seedModelReasoningConfigMap } from './initialState';

describe('seedModelReasoningConfigMap', () => {
  const models = [
    { id: 'gpt-5.6-sol', providerId: 'openai' },
    { id: 'claude-opus-5', providerId: 'anthropic' },
  ];

  it('marks every listed model as loaded, with undefined when nothing is saved', () => {
    const map = seedModelReasoningConfigMap(
      {},
      { 'openai/gpt-5.6-sol': { reasoningEffort: 'high' } },
      models,
      [],
    );

    expect(map).toEqual({
      'anthropic/claude-opus-5': undefined,
      'openai/gpt-5.6-sol': { reasoningEffort: 'high' },
    });
    expect('anthropic/claude-opus-5' in map).toBe(true);
  });

  it('replaces stale values with the server snapshot', () => {
    const map = seedModelReasoningConfigMap(
      { 'openai/gpt-5.6-sol': { reasoningEffort: 'low' } },
      {},
      models,
      [],
    );

    expect(map['openai/gpt-5.6-sol']).toBeUndefined();
  });

  it('keeps the optimistic value of a key with an in-flight save', () => {
    const map = seedModelReasoningConfigMap(
      { 'openai/gpt-5.6-sol': { reasoningEffort: 'xhigh' } },
      { 'openai/gpt-5.6-sol': { reasoningEffort: 'low' } },
      models,
      ['openai/gpt-5.6-sol'],
    );

    expect(map['openai/gpt-5.6-sol']).toEqual({ reasoningEffort: 'xhigh' });
  });

  it('keeps saved configs of models outside the enabled list', () => {
    const map = seedModelReasoningConfigMap(
      {},
      { 'azure/gpt-5.6-sol': { reasoningEffort: 'medium' } },
      [],
      [],
    );

    expect(map).toEqual({ 'azure/gpt-5.6-sol': { reasoningEffort: 'medium' } });
  });
});
