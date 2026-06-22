import { describe, expect, it } from 'vitest';

import { buildHeteroSpawnArgs, pruneWorkingDirByDeviceDeletes } from './agencyConfig';

describe('pruneWorkingDirByDeviceDeletes', () => {
  it('deletes keys whose patch value is undefined', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a', 'device-b': '/b' } };
    pruneWorkingDirByDeviceDeletes(merged, { workingDirByDevice: { 'device-a': undefined } });
    expect(merged.workingDirByDevice).toEqual({ 'device-b': '/b' });
  });

  it('leaves defined patch values untouched', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a' } };
    pruneWorkingDirByDeviceDeletes(merged, { workingDirByDevice: { 'device-a': '/a' } });
    expect(merged.workingDirByDevice).toEqual({ 'device-a': '/a' });
  });

  it('is a no-op when the patch has no workingDirByDevice', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a' } };
    pruneWorkingDirByDeviceDeletes(merged, {});
    pruneWorkingDirByDeviceDeletes(merged, undefined);
    pruneWorkingDirByDeviceDeletes(merged, null);
    expect(merged.workingDirByDevice).toEqual({ 'device-a': '/a' });
  });

  it('is a no-op when the merged target has no workingDirByDevice', () => {
    expect(() =>
      pruneWorkingDirByDeviceDeletes({}, { workingDirByDevice: { 'device-a': undefined } }),
    ).not.toThrow();
    expect(() =>
      pruneWorkingDirByDeviceDeletes(undefined, { workingDirByDevice: { 'device-a': undefined } }),
    ).not.toThrow();
  });
});

describe('buildHeteroSpawnArgs', () => {
  it('returns undefined when there is no provider', () => {
    expect(buildHeteroSpawnArgs(undefined)).toBeUndefined();
    expect(buildHeteroSpawnArgs(null)).toBeUndefined();
  });

  it('leaves non-claude-code providers untouched', () => {
    expect(
      buildHeteroSpawnArgs({ args: ['-m', 'gpt-5'], type: 'codex', model: 'opus', effort: 'high' }),
    ).toEqual(['-m', 'gpt-5']);
    // codex with no args returns its args unchanged (undefined)
    expect(buildHeteroSpawnArgs({ type: 'codex' })).toBeUndefined();
  });

  it('resolves missing claude-code model/effort to concrete defaults', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code' })).toEqual([
      '--model',
      'sonnet',
      '--effort',
      'medium',
    ]);
    expect(buildHeteroSpawnArgs({ args: ['--verbose'], type: 'claude-code' })).toEqual([
      '--verbose',
      '--model',
      'sonnet',
      '--effort',
      'medium',
    ]);
    // Older persisted "Default" selections resolve to the same concrete values.
    expect(
      buildHeteroSpawnArgs({ type: 'claude-code', model: '', effort: 'default' as never }),
    ).toEqual(['--model', 'sonnet', '--effort', 'medium']);
  });

  it('appends --model and --effort for claude-code', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code', model: 'opus', effort: 'high' })).toEqual([
      '--model',
      'opus',
      '--effort',
      'high',
    ]);
  });

  it('preserves existing args and appends after them', () => {
    expect(
      buildHeteroSpawnArgs({ args: ['--verbose'], type: 'claude-code', model: 'sonnet' }),
    ).toEqual(['--verbose', '--model', 'sonnet', '--effort', 'medium']);
  });

  it('uses concrete defaults for omitted flags', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code', effort: 'max' })).toEqual([
      '--model',
      'sonnet',
      '--effort',
      'max',
    ]);
    expect(buildHeteroSpawnArgs({ type: 'claude-code', model: 'haiku' })).toEqual([
      '--model',
      'haiku',
      '--effort',
      'medium',
    ]);
  });

  it('does not duplicate a flag the user already authored in args', () => {
    // space-separated form
    expect(
      buildHeteroSpawnArgs({
        args: ['--model', 'opus'],
        type: 'claude-code',
        model: 'sonnet',
        effort: 'high',
      }),
    ).toEqual(['--model', 'opus', '--effort', 'high']);
    // `--flag=value` form
    expect(
      buildHeteroSpawnArgs({
        args: ['--effort=low'],
        type: 'claude-code',
        model: 'opus',
        effort: 'high',
      }),
    ).toEqual(['--effort=low', '--model', 'opus']);
  });
});
