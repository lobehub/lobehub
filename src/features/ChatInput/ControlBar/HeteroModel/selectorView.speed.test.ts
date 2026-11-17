import type { HeterogeneousAgentModel, HeterogeneousSpeedMode } from '@lobechat/types';
import { getHeteroSelectorCapability } from '@lobechat/types';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { buildSelectorView, resolveModelSwitchSelection } from './selectorView';

const capability = getHeteroSelectorCapability('codex')!;
const t = ((key: string) => key) as unknown as TFunction<'chat'>;
const models: HeterogeneousAgentModel[] = [
  {
    id: 'gpt-6.1-sol',
    modelId: 'gpt-6.1-sol',
    providerId: 'codex',
    isDefault: true,
    speedModes: ['normal', 'fast'],
  },
  {
    id: 'gpt-6-astra',
    modelId: 'gpt-6-astra',
    providerId: 'codex',
    speedModes: ['normal', 'fast', 'ultrafast'],
  },
];
const view = (model: string, speed?: HeterogeneousSpeedMode, catalog = models) =>
  buildSelectorView({
    capability,
    models: catalog,
    provider: { type: 'codex', model, speed },
    t,
  });

describe('Codex speed menu', () => {
  it('offers only tiers returned by the execution device for the selected model', () => {
    const values = (model: string) =>
      view(model)
        .dimensions.find((d) => d.key === 'speed')!
        .options.map((o) => o.value);
    expect(values('gpt-6.1-sol')).toEqual(['default', 'normal', 'fast']);
    expect(values('gpt-6-astra')).toEqual(['default', 'normal', 'fast', 'ultrafast']);
    expect(values('default')).toEqual(['default', 'normal', 'fast']);
    expect(values('unknown')).toEqual(['default', 'normal']);
  });

  it('does not infer accelerated tiers while discovery is unavailable', () => {
    expect(
      view('gpt-6.1-sol', undefined, [])
        .dimensions.find((d) => d.key === 'speed')!
        .options.map((o) => o.value),
    ).toEqual(['default', 'normal']);
  });

  it('shows a saved unavailable tier as disabled so the user can choose Normal', () => {
    expect(
      view('gpt-6.1-sol', 'ultrafast').dimensions.find((d) => d.key === 'speed')!.options,
    ).toContainEqual(expect.objectContaining({ value: 'ultrafast', disabled: true }));
  });

  it('resets an unavailable accelerated tier to Normal when switching models', () => {
    expect(
      resolveModelSwitchSelection({
        capability: { ...capability, model: capability.model! },
        models,
        speed: 'ultrafast',
        value: 'gpt-6.1-sol',
      }),
    ).toEqual({ model: 'gpt-6.1-sol', speed: 'normal' });
  });
});
