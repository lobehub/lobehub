import { describe, expect, it } from 'vitest';

import {
  type EnvironmentConfiguration,
  layoutRepositorySources,
  toExecutionConfiguration,
} from './index';

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

describe('layoutRepositorySources', () => {
  const git = (url: string, path?: string) => ({
    kind: 'git' as const,
    url,
    ...(path && { path }),
  });

  it('keeps one repository at the top of the working directory', () => {
    const sources = [git('https://github.com/lobehub/lobehub')];
    expect(layoutRepositorySources(sources)).toBe(sources);
  });

  it('lays several out side by side, each in a folder named after it', () => {
    expect(
      layoutRepositorySources([
        git('https://github.com/lobehub/lobehub'),
        git('https://github.com/lobehub/lobe-ui.git'),
      ]),
    ).toEqual([
      git('https://github.com/lobehub/lobehub', 'lobehub'),
      git('https://github.com/lobehub/lobe-ui.git', 'lobe-ui'),
    ]);
  });

  it('keeps a folder the author chose and never puts two repositories in one', () => {
    expect(
      layoutRepositorySources([
        git('https://github.com/a/app', 'web'),
        git('https://github.com/a/app-docs', './'),
        git('https://github.com/b/app-docs'),
      ]),
    ).toEqual([
      git('https://github.com/a/app', 'web'),
      git('https://github.com/a/app-docs', 'app-docs'),
      git('https://github.com/b/app-docs', 'b-app-docs'),
    ]);
  });

  it('is what the execution plane is sent', () => {
    expect(
      toExecutionConfiguration({
        kind: 'code',
        sources: [git('https://github.com/a/one'), git('https://github.com/a/two')],
      }).sources,
    ).toEqual([git('https://github.com/a/one', 'one'), git('https://github.com/a/two', 'two')]);
  });
});
