import { describe, expect, it } from 'vitest';

import {
  applyTopicModelToHeterogeneousProvider,
  buildHeteroExecArgs,
  buildHeteroSpawnArgs,
} from './agencyConfig';
import { applyHeteroSelection, getHeteroSelectorCapability } from './heteroSelectorCapabilities';

describe('Antigravity model and effort selection', () => {
  it('exposes the native catalog and five effort levels', () => {
    const capability = getHeteroSelectorCapability('antigravity');
    expect(capability?.model?.source).toBe('catalog');
    expect(capability?.effort?.levels('any-model')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(capability?.model?.resolve({ model: 'custom-model' })).toBe('custom-model');
    expect(capability?.effort?.resolve({ args: ['--effort=max'], effort: 'low' })).toBe('max');
    expect(capability?.effort?.resolve({ effort: 'ultra' })).toBe('default');
  });

  it('passes model and effort through both native and CLI wrapper launches', () => {
    const provider = { type: 'antigravity' as const, model: 'custom-model', effort: 'max' };
    expect(buildHeteroSpawnArgs(provider)).toEqual(['--model', 'custom-model', '--effort', 'max']);
    expect(buildHeteroExecArgs(provider)).toEqual(['--model', 'custom-model', '--effort', 'max']);
    expect(
      buildHeteroSpawnArgs({ ...provider, model: 'default', effort: 'default' }),
    ).toBeUndefined();
    expect(
      buildHeteroExecArgs({ ...provider, model: 'default', effort: 'default' }),
    ).toBeUndefined();
  });

  it('lets explicit native args win and clears conflicting args after a new pick', () => {
    const provider = {
      type: 'antigravity' as const,
      args: ['--model=old', '--effort', 'low', '--sandbox'],
      model: 'stale',
      effort: 'max',
    };
    expect(buildHeteroSpawnArgs(provider)).toEqual(provider.args);
    expect(buildHeteroExecArgs(provider)).toEqual(provider.args.map((arg) => `--agent-arg=${arg}`));
    const patch = applyHeteroSelection(provider, { model: 'new', effort: 'high' });
    expect(patch).toEqual({ args: ['--sandbox'], model: 'new', effort: 'high' });
    expect(buildHeteroSpawnArgs({ ...provider, ...patch })).toEqual([
      '--sandbox',
      '--model',
      'new',
      '--effort',
      'high',
    ]);
  });

  it('applies topic model and effort pins without changing the Agent defaults', () => {
    const provider = { type: 'antigravity' as const, model: 'agent-model', effort: 'low' };
    const effective = applyTopicModelToHeterogeneousProvider(provider, {
      model: 'topic-model',
      provider: 'antigravity',
      effort: 'max',
    });
    expect(buildHeteroSpawnArgs(effective)).toEqual(['--model', 'topic-model', '--effort', 'max']);
    expect(provider).toEqual({ type: 'antigravity', model: 'agent-model', effort: 'low' });
  });
});
