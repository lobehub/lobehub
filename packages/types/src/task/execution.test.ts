import { describe, expect, it } from 'vitest';

import {
  hasTaskExecutionSelection,
  readTaskExecutionConfig,
  toTaskExecutionConfigPatch,
} from './execution';

describe('readTaskExecutionConfig', () => {
  it('returns nothing when the task carries no selection', () => {
    expect(readTaskExecutionConfig(undefined)).toBeUndefined();
    expect(readTaskExecutionConfig(null)).toBeUndefined();
    expect(readTaskExecutionConfig({})).toBeUndefined();
    expect(readTaskExecutionConfig({ model: 'gpt-4' })).toBeUndefined();
    expect(readTaskExecutionConfig({ execution: {} })).toBeUndefined();
  });

  it('reads back a pin and a working directory', () => {
    expect(
      readTaskExecutionConfig({
        execution: {
          boundDeviceId: 'device-a',
          repos: ['lobehub/lobehub'],
          workingDirectory: '/Users/me/Code/lobehub',
          workingDirectoryConfig: { path: '/Users/me/Code/lobehub', repoType: 'github' },
        },
      }),
    ).toEqual({
      boundDeviceId: 'device-a',
      repos: ['lobehub/lobehub'],
      workingDirectory: '/Users/me/Code/lobehub',
      workingDirectoryConfig: { path: '/Users/me/Code/lobehub', repoType: 'github' },
    });
  });

  it('treats the nulls a patch writes as "inherit", not as values', () => {
    expect(
      readTaskExecutionConfig({ execution: toTaskExecutionConfigPatch(undefined) }),
    ).toBeUndefined();
  });

  it('degrades malformed entries to inheritance instead of failing the run', () => {
    expect(readTaskExecutionConfig({ execution: 'device-a' })).toBeUndefined();
    expect(readTaskExecutionConfig({ execution: ['device-a'] })).toBeUndefined();
    expect(readTaskExecutionConfig({ execution: { boundDeviceId: '' } })).toBeUndefined();
    expect(readTaskExecutionConfig({ execution: { boundDeviceId: 42 } })).toBeUndefined();
    expect(readTaskExecutionConfig({ execution: { repos: 'lobehub/lobehub' } })).toBeUndefined();
    expect(readTaskExecutionConfig({ execution: { repos: ['', 'lobehub/lobehub'] } })).toEqual({
      repos: ['lobehub/lobehub'],
    });
    // A working-directory config without a path cannot describe a directory.
    expect(
      readTaskExecutionConfig({ execution: { workingDirectoryConfig: { repoType: 'github' } } }),
    ).toBeUndefined();
  });
});

describe('hasTaskExecutionSelection', () => {
  it('is false for nothing and for an object of empty values', () => {
    expect(hasTaskExecutionSelection(undefined)).toBe(false);
    expect(hasTaskExecutionSelection({})).toBe(false);
    expect(hasTaskExecutionSelection({ boundDeviceId: undefined })).toBe(false);
  });

  it('is true as soon as one axis is set', () => {
    expect(hasTaskExecutionSelection({ boundDeviceId: 'device-a' })).toBe(true);
    expect(hasTaskExecutionSelection({ repos: ['lobehub/lobehub'] })).toBe(true);
  });
});

describe('toTaskExecutionConfigPatch', () => {
  it('writes every axis, because the task config is updated by a deep merge', () => {
    // An omitted key would keep its previous value under the merge, so a
    // cleared axis has to be written as an explicit null.
    expect(toTaskExecutionConfigPatch(undefined)).toEqual({
      boundDeviceId: null,
      repos: null,
      workingDirectory: null,
      workingDirectoryConfig: null,
    });
  });

  it('round-trips a selection through the reader', () => {
    const execution = { boundDeviceId: 'device-a', repos: ['lobehub/lobehub'] };
    expect(readTaskExecutionConfig({ execution: toTaskExecutionConfigPatch(execution) })).toEqual(
      execution,
    );
  });
});
