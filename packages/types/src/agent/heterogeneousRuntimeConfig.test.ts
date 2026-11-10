import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveHeterogeneousRuntimeConfig } from './heterogeneousRuntimeConfig';

const codex: HeterogeneousProviderConfig = {
  args: ['--model', 'gpt-5.5'],
  effort: 'high',
  speed: 'fast',
  type: 'codex',
};

describe('resolveHeterogeneousRuntimeConfig', () => {
  it('exposes the effective Agent runtime, model, effort and speed', () => {
    expect(resolveHeterogeneousRuntimeConfig({ ...codex, model: 'gpt-5.4' })).toEqual([
      { key: 'runtime', source: 'agent', value: 'codex' },
      { key: 'model', source: 'agent', value: 'gpt-5.5' },
      { key: 'effort', source: 'agent', value: 'high' },
      { key: 'speed', source: 'agent', value: 'fast' },
    ]);
  });

  it('identifies a Task override even when its value equals the Agent value', () => {
    expect(
      resolveHeterogeneousRuntimeConfig(codex, { model: 'gpt-5.5', provider: 'codex' })[1],
    ).toEqual({
      key: 'model',
      source: 'task',
      value: 'gpt-5.5',
    });
  });

  it('uses the runtime provider for a model-only Task override', () => {
    expect(resolveHeterogeneousRuntimeConfig(codex, { model: 'gpt-5.4' })[1]).toEqual({
      key: 'model',
      source: 'task',
      value: 'gpt-5.4',
    });
    expect(resolveHeterogeneousRuntimeConfig(codex, { model: 'gpt-5.4' }, 'topic')[1]).toEqual({
      key: 'model',
      source: 'agent',
      value: 'gpt-5.5',
    });
  });

  it('reports Topic model and effort pins independently', () => {
    const fields = resolveHeterogeneousRuntimeConfig(
      codex,
      { effort: 'default', model: 'gpt-5.4', provider: 'codex' },
      'topic',
    );
    expect(fields.slice(1, 3)).toEqual([
      { key: 'model', source: 'topic', value: 'gpt-5.4' },
      { key: 'effort', source: 'topic', value: 'default' },
    ]);
    expect(fields[3]).toEqual({ key: 'speed', source: 'agent', value: 'fast' });
  });

  it('prioritizes Topic speed provenance over Agent and CLI defaults', () => {
    for (const speed of ['fast', 'default'] as const) {
      const fields = resolveHeterogeneousRuntimeConfig(codex, { speed }, 'topic');
      expect(fields.find((field) => field.key === 'speed')).toEqual({
        key: 'speed',
        source: 'topic',
        value: speed,
      });
    }
    expect(resolveHeterogeneousRuntimeConfig(codex).find((field) => field.key === 'speed')).toEqual(
      {
        key: 'speed',
        source: 'agent',
        value: 'fast',
      },
    );
  });

  it('does not attribute a rejected provider pin to the Task', () => {
    expect(
      resolveHeterogeneousRuntimeConfig(codex, { model: 'gpt-4o', provider: 'openai' })[1],
    ).toEqual({
      key: 'model',
      source: 'agent',
      value: 'gpt-5.5',
    });
  });

  it('does not display a chat-model Task snapshot as the API binding', () => {
    const api: HeterogeneousProviderConfig = {
      apiConfig: { model: 'deepseek-v4-pro', providerId: 'deepseek' },
      authMode: 'api',
      type: 'codex',
    };
    expect(
      resolveHeterogeneousRuntimeConfig(api, { model: 'gpt-4o-mini', provider: 'openai' })[1],
    ).toEqual({ key: 'model', source: 'agent', value: 'deepseek-v4-pro' });
    expect(
      resolveHeterogeneousRuntimeConfig(api, {
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
      })[1],
    ).toEqual({ key: 'model', source: 'task', value: 'deepseek-v4-flash' });
  });

  it('preserves server-default API model ownership', () => {
    expect(
      resolveHeterogeneousRuntimeConfig(
        {
          ...codex,
          apiConfig: { model: 'gpt-5.4', source: 'server-default' },
          authMode: 'api',
        },
        { model: 'gpt-5.5', provider: 'codex' },
        'topic',
      )[1],
    ).toEqual({
      key: 'model',
      source: 'agent',
      value: 'gpt-5.4',
    });
  });

  it('reports Amp mode without inventing a model dimension', () => {
    expect(resolveHeterogeneousRuntimeConfig({ mode: 'high', type: 'amp' })).toEqual([
      { key: 'runtime', source: 'agent', value: 'amp' },
      { key: 'mode', source: 'agent', value: 'high' },
    ]);
    expect(resolveHeterogeneousRuntimeConfig({ type: 'amp' })[1]).toEqual({
      key: 'mode',
      source: 'runtime',
      value: 'default',
    });
  });

  it('does not invent values for device-resolved defaults', () => {
    expect(resolveHeterogeneousRuntimeConfig({ type: 'codex' }).slice(1)).toEqual([
      { key: 'model', source: 'runtime', value: 'default' },
      { key: 'effort', source: 'runtime', value: 'default' },
      { key: 'speed', source: 'runtime', value: 'default' },
    ]);
  });
});
