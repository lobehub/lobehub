import { describe, expect, it } from 'vitest';

import type { HeterogeneousProviderConfig } from './agencyConfig';
import { buildHeteroSpawnArgs } from './agencyConfig';
import {
  applyHeteroSelection,
  getHeteroSelectorCapability,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
  isHeteroSelectorAvailable,
} from './heteroSelectorCapabilities';

describe('selector availability', () => {
  it('derives the selectable provider set from the model dimension', () => {
    expect(isHeteroSelectorAvailable('claude-code')).toBe(true);
    expect(isHeteroSelectorAvailable('codebuddy')).toBe(true);
    expect(isHeteroSelectorAvailable('codex')).toBe(true);
    expect(isHeteroSelectorAvailable('opencode')).toBe(true);
    expect(isHeteroSelectorAvailable('pi')).toBe(true);
    expect(isHeteroSelectorAvailable('qoder')).toBe(true);

    expect(isHeteroSelectorAvailable('amp')).toBe(false);
    expect(isHeteroSelectorAvailable('cursor')).toBe(false);
    expect(isHeteroSelectorAvailable('kimi-code')).toBe(false);
    expect(isHeteroSelectorAvailable('openclaw')).toBe(false);
    expect(isHeteroSelectorAvailable(undefined)).toBe(false);
  });

  it('exposes the dimensions each provider actually supports', () => {
    expect(getHeteroSelectorCapability('claude-code')?.speed).toBeUndefined();
    expect(getHeteroSelectorCapability('codex')?.speed).toBeDefined();
    expect(getHeteroSelectorCapability('cursor')?.model).toBeUndefined();
    expect(getHeteroSelectorCapability('opencode')?.effort).toBeUndefined();
    expect(getHeteroSelectorCapability('qoder')?.effort).toBeDefined();
    expect(getHeteroSelectorCapability('codex')?.model?.source).toBe('static');
    expect(getHeteroSelectorCapability('codebuddy')?.model?.source).toBe('catalog');
    expect(getHeteroSelectorCapability('qoder')?.model?.source).toBe('catalog');
  });

  it('reports codex effort levels per model', () => {
    const levels = getHeteroSelectorCapability('codex')?.effort?.levels;

    expect(levels?.('gpt-5.6-sol')).toContain('ultra');
    expect(levels?.('gpt-5.6-luna')).toContain('max');
    expect(levels?.('gpt-5.6-luna')).not.toContain('ultra');
    expect(levels?.('gpt-5.4')).not.toContain('max');
  });
});

describe('applyHeteroSelection', () => {
  it('passes the selection through untouched for providers with no selector', () => {
    expect(applyHeteroSelection({ args: ['--model', 'x'], type: 'amp' }, { model: 'y' })).toEqual({
      model: 'y',
    });
  });

  it('leaves args alone when the provider is unknown', () => {
    expect(applyHeteroSelection(undefined, { model: 'y' })).toEqual({ model: 'y' });
  });

  it('clears the claude-code model flag without touching unrelated args', () => {
    expect(
      applyHeteroSelection(
        { args: ['--verbose', '--model', 'sonnet', '--foo=bar'], type: 'claude-code' },
        { model: 'opus' },
      ),
    ).toEqual({ args: ['--verbose', '--foo=bar'], model: 'opus' });
  });

  it('clears the claude-code effort flag in its joined spelling', () => {
    expect(
      applyHeteroSelection(
        { args: ['--effort=high', '-p'], type: 'claude-code' },
        { effort: 'low' },
      ),
    ).toEqual({ args: ['-p'], effort: 'low' });
  });

  it('clears CodeBuddy model and effort flags before applying a selection', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--model', 'old', '--effort=high', '--verbose'],
      type: 'codebuddy',
    };
    const patch = applyHeteroSelection(provider, { effort: 'low', model: 'gpt-5.4' });

    expect(patch).toEqual({ args: ['--verbose'], effort: 'low', model: 'gpt-5.4' });
    expect(buildHeteroSpawnArgs({ ...provider, ...patch })).toEqual([
      '--verbose',
      '--model',
      'gpt-5.4',
      '--effort',
      'low',
    ]);
  });

  it('clears both codex model spellings at once', () => {
    expect(
      applyHeteroSelection(
        { args: ['-m', 'gpt-5.5', '-c', 'model="gpt-5.4"', '--sandbox', 'danger'], type: 'codex' },
        { model: 'gpt-5.6-sol' },
      ),
    ).toEqual({ args: ['--sandbox', 'danger'], model: 'gpt-5.6-sol' });
  });

  it('clears the codex effort config key but keeps other config overrides', () => {
    expect(
      applyHeteroSelection(
        {
          args: ['-c', 'model_reasoning_effort="high"', '-c', 'sandbox_mode="read-only"'],
          type: 'codex',
        },
        { effort: 'low' },
      ),
    ).toEqual({ args: ['-c', 'sandbox_mode="read-only"'], effort: 'low' });
  });

  it('clears the codex service tier in the joined --config spelling', () => {
    expect(
      applyHeteroSelection(
        { args: ['--config=service_tier="priority"', '--full-auto'], type: 'codex' },
        { speed: HETEROGENEOUS_AGENT_DEFAULT_SELECTION },
      ),
    ).toEqual({ args: ['--full-auto'], speed: HETEROGENEOUS_AGENT_DEFAULT_SELECTION });
  });

  it('clears every dimension named in a combined patch', () => {
    expect(
      applyHeteroSelection(
        {
          args: [
            '--model',
            'gpt-5.5',
            '-c',
            'model_reasoning_effort="max"',
            '-c',
            'service_tier="fast"',
          ],
          type: 'codex',
        },
        { effort: HETEROGENEOUS_AGENT_DEFAULT_SELECTION, model: 'gpt-5.4', speed: 'default' },
      ),
    ).toEqual({
      args: [],
      effort: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
      model: 'gpt-5.4',
      speed: 'default',
    });
  });

  it('clears the qoder reasoning-effort flag', () => {
    expect(
      applyHeteroSelection(
        { args: ['--reasoning-effort', 'high', '-p'], type: 'qoder' },
        { effort: 'low' },
      ),
    ).toEqual({ args: ['-p'], effort: 'low' });
  });

  it('clears pi provider alongside the model so a stale half cannot survive', () => {
    expect(
      applyHeteroSelection(
        { args: ['--provider', 'anthropic', '--model', 'old'], type: 'pi' },
        { model: 'openai/gpt-5' },
      ),
    ).toEqual({ args: [], model: 'openai/gpt-5' });
  });

  it('ignores dimensions the provider does not expose', () => {
    expect(
      applyHeteroSelection({ args: ['--model', 'x'], type: 'qoder' }, { speed: 'fast' }),
    ).toEqual({ speed: 'fast' });
  });

  it('returns undefined args when the provider had none', () => {
    expect(applyHeteroSelection({ type: 'codex' }, { model: 'gpt-5.4' })).toEqual({
      args: undefined,
      model: 'gpt-5.4',
    });
  });

  it('makes the selection observable to the spawn args builder', () => {
    const stale: HeterogeneousProviderConfig = {
      args: ['--model', 'sonnet'],
      model: 'sonnet',
      type: 'claude-code',
    };

    expect(buildHeteroSpawnArgs({ ...stale, model: 'opus' })).toEqual(['--model', 'sonnet']);

    const patched = { ...stale, ...applyHeteroSelection(stale, { model: 'opus' }) };

    expect(buildHeteroSpawnArgs(patched)).toEqual(['--model', 'opus']);
  });
});
