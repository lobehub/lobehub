import { describe, expect, it } from 'vitest';

import {
  buildHeteroSpawnArgs,
  pruneWorkingDirByDeviceDeletes,
  resolveClaudeCodeModel,
  resolveClaudeCodeReasoningEffort,
} from './agencyConfig';

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
  it('resolves missing claude-code selections to concrete display defaults', () => {
    expect(resolveClaudeCodeModel(undefined)).toBe('sonnet');
    expect(resolveClaudeCodeReasoningEffort(undefined)).toBe('high');
  });

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

  it('preserves Claude Code defaults when model/effort have not been selected', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code' })).toBeUndefined();
    expect(buildHeteroSpawnArgs({ args: ['--verbose'], type: 'claude-code' })).toEqual([
      '--verbose',
    ]);
    // Older persisted "Default" selections should behave like unset values.
    expect(
      buildHeteroSpawnArgs({ type: 'claude-code', model: '', effort: 'default' as never }),
    ).toBeUndefined();
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
    ).toEqual(['--verbose', '--model', 'sonnet']);
  });

  it('only appends explicitly selected flags', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code', effort: 'max' })).toEqual([
      '--effort',
      'max',
    ]);
    expect(buildHeteroSpawnArgs({ type: 'claude-code', model: 'haiku' })).toEqual([
      '--model',
      'haiku',
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
