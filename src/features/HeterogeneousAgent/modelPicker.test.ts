import type { LobeDefaultAiModelListItem } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  buildServerDefaultModelOptions,
  compactModelTriggerText,
  resolveServerDefaultAgentModels,
  resolveServerDefaultModelMeta,
} from './modelPicker';

const catalogItem = (partial: {
  displayName?: string;
  id: string;
  providerId: string;
}): LobeDefaultAiModelListItem =>
  ({
    abilities: {},
    ...partial,
  }) as LobeDefaultAiModelListItem;

describe('resolveServerDefaultAgentModels', () => {
  it('returns an empty list when an older server omits the requested agent entry', () => {
    const legacyModels = {
      'claude-code': [{ model: 'claude-sonnet-4-6' }],
      'codex': [{ model: 'gpt-5.6' }],
    };

    expect(resolveServerDefaultAgentModels(legacyModels, 'kimi-code')).toEqual([]);
    expect(resolveServerDefaultAgentModels(legacyModels, 'claude-code')).toEqual([
      { model: 'claude-sonnet-4-6' },
    ]);
  });
});

describe('resolveServerDefaultModelMeta', () => {
  it('prefers the LobeHub catalog entry over another provider with the same id', () => {
    const meta = resolveServerDefaultModelMeta('gpt-5.6', [
      catalogItem({ displayName: 'OpenAI GPT', id: 'gpt-5.6', providerId: 'openai' }),
      catalogItem({ displayName: 'GPT-5.6', id: 'gpt-5.6', providerId: 'lobehub' }),
    ]);

    expect(meta?.displayName).toBe('GPT-5.6');
  });

  it('falls back to any catalog match, then to undefined', () => {
    expect(
      resolveServerDefaultModelMeta('gpt-5.6', [
        catalogItem({ displayName: 'OpenAI GPT', id: 'gpt-5.6', providerId: 'openai' }),
      ])?.displayName,
    ).toBe('OpenAI GPT');
    expect(resolveServerDefaultModelMeta('gpt-5.6-sol', [])).toBeUndefined();
  });
});

describe('compactModelTriggerText', () => {
  it('uses the Select title when present', () => {
    expect(compactModelTriggerText({ title: 'GPT-5.6', value: 'gpt-5.6' })).toBe('GPT-5.6');
    expect(
      compactModelTriggerText({ title: 'Claude Opus 4.1', value: 'anthropic/claude-opus-4-1' }),
    ).toBe('Claude Opus 4.1');
  });

  it('falls back to the model id, not a namespaced provider/model value', () => {
    expect(compactModelTriggerText({ value: 'anthropic/claude-opus-4-1' })).toBe('claude-opus-4-1');
    expect(compactModelTriggerText({ value: 'gpt-5.6' })).toBe('gpt-5.6');
  });
});

describe('buildServerDefaultModelOptions', () => {
  it('puts the catalog display name on Select title for the closed trigger', () => {
    const options = buildServerDefaultModelOptions(
      [{ model: 'gpt-5.6' }],
      [catalogItem({ displayName: 'GPT-5.6', id: 'gpt-5.6', providerId: 'lobehub' })],
    );

    expect(options[0]).toMatchObject({ title: 'GPT-5.6', value: 'gpt-5.6' });
  });
});
