import { describe, expect, it } from 'vitest';

import { type EnvironmentConfiguration, toExecutionConfiguration } from './index';

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
    expect(toExecutionConfiguration({ kind: 'code' })).toEqual({});
  });

  it('leaves a definition without a kind as it was', () => {
    expect(toExecutionConfiguration(before)).toEqual(before);
  });
});
