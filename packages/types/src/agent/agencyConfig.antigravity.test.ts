import { describe, expect, it } from 'vitest';

import {
  applyTopicModelToHeterogeneousProvider,
  buildHeteroExecArgs,
  buildHeteroSpawnArgs,
} from './agencyConfig';
import { applyHeteroSelection, getHeteroSelectorCapability } from './heteroSelectorCapabilities';

describe('Antigravity model and effort selection', () => {
  it('reads the native model and effort arguments independently', () => {
    const capability = getHeteroSelectorCapability('antigravity');
    expect(capability?.model?.source).toBe('catalog');
    expect(capability?.effort?.resolve({ args: ['--effort=high'] })).toBe('high');
    expect(capability?.model?.resolve({ model: 'gemini-4-argon-high' })).toBe(
      'gemini-4-argon-high',
    );
  });

  it('passes the complete model variant through native and CLI wrapper launches', () => {
    const provider = { type: 'antigravity' as const, model: 'gemini-4-argon-high' };
    expect(buildHeteroSpawnArgs(provider)).toEqual(['--model', 'gemini-4-argon-high']);
    const selected = { ...provider, model: 'gemini-4-argon', effort: 'high' } as const;
    expect(buildHeteroSpawnArgs(selected)).toEqual([
      '--model',
      'gemini-4-argon',
      '--effort',
      'high',
    ]);
    expect(buildHeteroExecArgs(selected)).toEqual([
      '--model',
      'gemini-4-argon',
      '--effort',
      'high',
    ]);
    expect(buildHeteroExecArgs(provider)).toEqual(['--model', 'gemini-4-argon-high']);
    expect(buildHeteroSpawnArgs({ ...provider, model: 'default' })).toBeUndefined();
    expect(buildHeteroExecArgs({ ...provider, model: 'default' })).toBeUndefined();
  });

  it('replaces the configured model argument when picking another variant', () => {
    const provider = {
      type: 'antigravity' as const,
      args: ['--model=gemini-4-argon-low', '--sandbox'],
    };
    const patch = applyHeteroSelection(provider, { model: 'gemini-4-argon-high' });
    expect(patch).toEqual({ args: ['--sandbox'], model: 'gemini-4-argon-high' });
    expect(buildHeteroSpawnArgs({ ...provider, ...patch })).toEqual([
      '--sandbox',
      '--model',
      'gemini-4-argon-high',
    ]);
    expect(buildHeteroExecArgs({ ...provider, ...patch })).toEqual([
      '--agent-arg=--sandbox',
      '--model',
      'gemini-4-argon-high',
    ]);
  });

  it('uses the topic variant without changing the Agent default', () => {
    const provider = { type: 'antigravity', model: 'gemini-4-argon-low' } as const;
    const effective = applyTopicModelToHeterogeneousProvider(provider, {
      effort: 'high',
      model: 'gemini-4-argon',
      provider: 'antigravity',
    });
    expect(buildHeteroSpawnArgs(effective)).toEqual([
      '--model',
      'gemini-4-argon',
      '--effort',
      'high',
    ]);
    expect(buildHeteroExecArgs(effective)).toEqual([
      '--model',
      'gemini-4-argon',
      '--effort',
      'high',
    ]);
    expect(provider).toEqual({ type: 'antigravity', model: 'gemini-4-argon-low' });
  });
});
