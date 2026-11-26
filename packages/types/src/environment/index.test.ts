import { describe, expect, it } from 'vitest';

import {
  type EnvironmentConfiguration,
  layoutRepositorySources,
  toExecutionConfiguration,
  withRepositorySetup,
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

  it('keeps the notes out of what the execution plane digests', () => {
    expect(toExecutionConfiguration({ ...before, notes: 'dev needs 8 GB of memory' })).toEqual(
      before,
    );
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

describe('withRepositorySetup', () => {
  it('leaves a definition without repository setup untouched', () => {
    const configuration = {
      bootstrapCommand: 'pnpm i',
      sources: [{ kind: 'git' as const, url: 'https://github.com/a/one' }],
    };
    expect(withRepositorySetup(configuration)).toBe(configuration);
  });

  it("runs each repository's setup in its folder, then the environment's own", () => {
    const result = withRepositorySetup({
      bootstrapCommand: 'make all',
      sources: [
        { kind: 'git', setupCommand: 'pnpm i', url: 'https://github.com/a/web' },
        { kind: 'git', url: 'https://github.com/a/docs' },
        { kind: 'git', setupCommand: "echo 'hi'", url: 'https://github.com/a/api' },
      ],
    });
    expect(result.bootstrapCommand).toBe(
      "(cd 'web' && pnpm i\n) && (cd 'api' && echo 'hi'\n) && (make all\n)",
    );
    expect(result.sources).toEqual([
      { kind: 'git', url: 'https://github.com/a/web' },
      { kind: 'git', url: 'https://github.com/a/docs' },
      { kind: 'git', url: 'https://github.com/a/api' },
    ]);
  });

  it('runs a lone repository setup at the top, where that repository is checked out', () => {
    expect(
      withRepositorySetup({
        sources: [{ kind: 'git', setupCommand: 'npm ci', url: 'https://github.com/a/one' }],
      }).bootstrapCommand,
    ).toBe("(cd '.' && npm ci\n)");
  });

  it('is applied on the way to the execution plane', () => {
    expect(
      toExecutionConfiguration({
        kind: 'code',
        sources: [{ kind: 'git', setupCommand: 'npm ci', url: 'https://github.com/a/one' }],
      }),
    ).toEqual({
      bootstrapCommand: "(cd '.' && npm ci\n)",
      sources: [{ kind: 'git', url: 'https://github.com/a/one' }],
    });
  });
});
