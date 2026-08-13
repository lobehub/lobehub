import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { applyHeteroSelection, getHeteroSelectorCapability } from '@lobechat/types';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { ModelCapability } from './selectorView';
import {
  buildSelectorView,
  resolveModelSwitchSelection,
  resolveSelectorShape,
} from './selectorView';

const t = ((key: string) => key) as unknown as TFunction<'chat'>;

const capabilityOf = (type: string): ModelCapability => {
  const capability = getHeteroSelectorCapability(type);
  if (!capability?.model) throw new Error(`no selector capability for ${type}`);

  return { ...capability, model: capability.model };
};

const viewOf = (provider: HeterogeneousProviderConfig) =>
  buildSelectorView({ capability: capabilityOf(provider.type), provider, t });

const dimensionKeys = (provider: HeterogeneousProviderConfig) =>
  viewOf(provider).dimensions.map((dimension) => dimension.key);

describe('resolveSelectorShape', () => {
  it('renders nothing for providers with no selector', () => {
    expect(resolveSelectorShape({ type: 'amp' }, true).kind).toBe('none');
    expect(resolveSelectorShape(undefined, true).kind).toBe('none');
  });

  it('renders nothing when the caller cannot configure the shared provider', () => {
    expect(resolveSelectorShape({ model: 'opus', type: 'claude-code' }, false).kind).toBe('none');
  });

  it('gives catalog-only providers the bare picker', () => {
    expect(resolveSelectorShape({ type: 'opencode' }, true).kind).toBe('catalog');
    expect(resolveSelectorShape({ type: 'pi' }, true).kind).toBe('catalog');
  });

  it('gives a catalog provider with another dimension the full menu', () => {
    expect(resolveSelectorShape({ type: 'codebuddy' }, true).kind).toBe('menu');
    expect(resolveSelectorShape({ type: 'qoder' }, true).kind).toBe('menu');
  });

  it('gives static providers the full menu', () => {
    expect(resolveSelectorShape({ type: 'claude-code' }, true).kind).toBe('menu');
    expect(resolveSelectorShape({ type: 'codex' }, true).kind).toBe('menu');
  });
});

describe('dimensions per provider', () => {
  it('offers model, reasoning and speed for a fast-capable codex model', () => {
    expect(dimensionKeys({ model: 'gpt-5.6-sol', type: 'codex' })).toEqual([
      'model',
      'reasoning',
      'speed',
    ]);
  });

  it('hides speed for codex models without a fast tier', () => {
    expect(dimensionKeys({ model: 'gpt-5.3-codex-spark', type: 'codex' })).toEqual([
      'model',
      'reasoning',
    ]);
  });

  it('offers model and reasoning but never speed for claude-code', () => {
    expect(dimensionKeys({ model: 'opus', type: 'claude-code' })).toEqual(['model', 'reasoning']);
  });

  it('loads the CodeBuddy model dimension from its CLI catalog and keeps reasoning in the menu', () => {
    const view = viewOf({ effort: 'high', model: 'gpt-5.4', type: 'codebuddy' });

    expect(view.isCatalogModel).toBe(true);
    expect(view.dimensions.map((dimension) => dimension.key)).toEqual(['reasoning']);
  });

  it('leaves the model dimension to the catalog picker for qoder', () => {
    const view = viewOf({ model: 'qwen3-coder', type: 'qoder' });

    expect(view.isCatalogModel).toBe(true);
    expect(view.dimensions.map((dimension) => dimension.key)).toEqual(['reasoning']);
  });

  it('narrows codex reasoning levels to what the model serves', () => {
    const solLevels = viewOf({ model: 'gpt-5.6-sol', type: 'codex' }).dimensions[1].options;
    const lunaLevels = viewOf({ model: 'gpt-5.6-luna', type: 'codex' }).dimensions[1].options;

    expect(solLevels.map((option) => option.value)).toContain('ultra');
    expect(lunaLevels.map((option) => option.value)).toContain('max');
    expect(lunaLevels.map((option) => option.value)).not.toContain('ultra');
  });

  it('keeps an off-catalog model pickable so the menu never drops the current value', () => {
    const options = viewOf({ model: 'gpt-4o-legacy', type: 'codex' }).dimensions[0].options;

    expect(options[0]).toEqual({ label: 'gpt-4o-legacy', value: 'gpt-4o-legacy' });
  });
});

describe('current value surfaced on each dimension', () => {
  it('shows the resolved model and effort labels', () => {
    const view = viewOf({ effort: 'high', model: 'opus', type: 'claude-code' });

    expect(view.dimensions[0].valueLabel).toBe('Opus 4.8');
    expect(view.dimensions[1].valueLabel).toBe('heteroAgent.modelSelector.reasoning.high');
  });

  it('prefers a contradicting arg over the persisted field, matching spawn behaviour', () => {
    const view = viewOf({ args: ['--model', 'haiku'], model: 'opus', type: 'claude-code' });

    expect(view.dimensions[0].valueLabel).toBe('Haiku 4.5');
  });

  it('renames codex low effort to Light', () => {
    const view = viewOf({ effort: 'low', model: 'gpt-5.4', type: 'codex' });

    expect(view.dimensions[1].valueLabel).toBe('heteroAgent.modelSelector.reasoning.light');
  });

  it('keeps the plain Low wording for claude-code', () => {
    const view = viewOf({ effort: 'low', model: 'opus', type: 'claude-code' });

    expect(view.dimensions[1].valueLabel).toBe('heteroAgent.modelSelector.reasoning.low');
  });

  it('flags fast speed so the trigger can badge it', () => {
    expect(viewOf({ model: 'gpt-5.6-sol', speed: 'fast', type: 'codex' }).isFastSpeed).toBe(true);
    expect(viewOf({ model: 'gpt-5.6-sol', type: 'codex' }).isFastSpeed).toBe(false);
  });

  it('ignores a fast speed the current model cannot serve', () => {
    expect(viewOf({ model: 'gpt-5.3-codex-spark', speed: 'fast', type: 'codex' }).isFastSpeed).toBe(
      false,
    );
  });

  it('collapses the trigger to one label when nothing is overridden', () => {
    expect(viewOf({ type: 'claude-code' }).triggerText).toBe(
      'heteroAgent.modelSelector.defaultConfig',
    );
  });

  it('names both halves in the trigger once either is overridden', () => {
    expect(viewOf({ model: 'opus', type: 'claude-code' }).triggerText).toBe(
      'Opus 4.8 heteroAgent.modelSelector.defaultReasoning',
    );
  });
});

describe('resolveModelSwitchSelection', () => {
  it('resets a fast speed the newly picked codex model cannot serve', () => {
    expect(
      resolveModelSwitchSelection({
        capability: capabilityOf('codex'),
        isFastSpeed: true,
        value: 'gpt-5.3-codex-spark',
      }),
    ).toEqual({ model: 'gpt-5.3-codex-spark', speed: 'default' });
  });

  it('keeps a fast speed the newly picked codex model still serves', () => {
    expect(
      resolveModelSwitchSelection({
        capability: capabilityOf('codex'),
        isFastSpeed: true,
        value: 'gpt-5.5',
      }),
    ).toEqual({ model: 'gpt-5.5' });
  });

  it('resets an effort level the newly picked codex model cannot serve', () => {
    expect(
      resolveModelSwitchSelection({
        capability: capabilityOf('codex'),
        effort: 'ultra',
        isFastSpeed: false,
        value: 'gpt-5.4',
      }),
    ).toEqual({ effort: 'default', model: 'gpt-5.4' });
  });

  it('never resets effort for providers whose levels do not depend on the model', () => {
    expect(
      resolveModelSwitchSelection({
        capability: capabilityOf('claude-code'),
        effort: 'max',
        isFastSpeed: false,
        value: 'haiku',
      }),
    ).toEqual({ model: 'haiku' });
  });
});

describe('what a pick persists', () => {
  it('clears the contradicting claude-code arg', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--verbose', '--model', 'haiku'],
      type: 'claude-code',
    };

    expect(
      applyHeteroSelection(
        provider,
        resolveModelSwitchSelection({
          capability: capabilityOf('claude-code'),
          isFastSpeed: false,
          value: 'opus',
        }),
      ),
    ).toEqual({ args: ['--verbose'], model: 'opus' });
  });

  it('clears both codex model spellings', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['-m', 'gpt-5.5', '-c', 'model="gpt-5.4"'],
      type: 'codex',
    };

    expect(
      applyHeteroSelection(
        provider,
        resolveModelSwitchSelection({
          capability: capabilityOf('codex'),
          isFastSpeed: false,
          value: 'gpt-5.6-sol',
        }),
      ),
    ).toEqual({ args: [], model: 'gpt-5.6-sol' });
  });

  it('clears the qoder reasoning-effort flag', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--reasoning-effort', 'high', '-p'],
      type: 'qoder',
    };

    expect(applyHeteroSelection(provider, { effort: 'low' })).toEqual({
      args: ['-p'],
      effort: 'low',
    });
  });
});
