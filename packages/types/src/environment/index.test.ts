import { describe, expect, it } from 'vitest';

import { type EnvironmentConfiguration, environmentKind, toExecutionConfiguration } from './index';

describe('environmentKind', () => {
  it('uses the stored kind when there is one, whatever else is configured', () => {
    expect(
      environmentKind({
        configuration: {
          kind: 'files',
          sources: [{ kind: 'git', url: 'https://github.com/a/b' }],
        },
      }),
    ).toBe('files');
    expect(environmentKind({ configuration: { kind: 'code' } })).toBe('code');
  });

  it('reads an environment with a repository and no stored kind as code', () => {
    expect(
      environmentKind({
        configuration: { sources: [{ kind: 'git', url: 'https://github.com/a/b' }] },
      }),
    ).toBe('code');
  });

  it('reads an environment with a setup command and no stored kind as code', () => {
    expect(environmentKind({ configuration: { bootstrapCommand: 'pnpm install' } })).toBe('code');
  });

  it('reads an environment with neither as files', () => {
    expect(environmentKind({ configuration: {} })).toBe('files');
    expect(environmentKind({ configuration: { bootstrapCommand: '  ', sources: [] } })).toBe(
      'files',
    );
    expect(environmentKind({ configuration: { env: { REGION: 'us' } } })).toBe('files');
    expect(environmentKind({ configuration: null })).toBe('files');
    expect(environmentKind(undefined)).toBe('files');
  });
});

describe('toExecutionConfiguration', () => {
  const before: EnvironmentConfiguration = {
    bootstrapCommand: 'pnpm install',
    env: { REGION: 'us' },
    excludePaths: ['node_modules'],
    internetAccess: false,
    maintenanceCommand: 'git pull',
    sources: [{ kind: 'git', ref: 'main', url: 'https://github.com/a/b' }],
  };

  it('sends the same definition whether or not a kind was stored', () => {
    expect(toExecutionConfiguration({ ...before, kind: 'code' })).toEqual(before);
    expect(toExecutionConfiguration({ kind: 'files' })).toEqual({});
  });

  it('leaves a definition without a kind as it was', () => {
    expect(toExecutionConfiguration(before)).toEqual(before);
  });
});
