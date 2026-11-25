import { describe, expect, it } from 'vitest';

import { configurationSchema } from '../environment';

describe('configurationSchema sources', () => {
  const git = (url: string, path?: string) => ({
    kind: 'git' as const,
    url,
    ...(path && { path }),
  });

  it('accepts repositories in folders of their own, or left to the layout', () => {
    expect(
      configurationSchema.safeParse({
        sources: [git('https://github.com/a/one'), git('https://github.com/a/two', 'two')],
      }).success,
    ).toBe(true);
  });

  it('refuses two repositories checked out into the same folder', () => {
    const result = configurationSchema.safeParse({
      sources: [git('https://github.com/a/one', 'app'), git('https://github.com/a/two', './app/')],
    });
    expect(result.success).toBe(false);
  });

  it('takes a setup command for a single repository', () => {
    expect(
      configurationSchema.safeParse({
        sources: [{ ...git('https://github.com/a/one'), setupCommand: 'pnpm i' }],
      }).success,
    ).toBe(true);
  });
});

describe('configurationSchema runNotes', () => {
  it('keeps run notes instead of stripping them', () => {
    const result = configurationSchema.parse({ runNotes: 'Needs 8 GB of memory for dev' });
    expect(result.runNotes).toBe('Needs 8 GB of memory for dev');
  });

  it('refuses run notes longer than 4000 characters', () => {
    expect(configurationSchema.safeParse({ runNotes: 'x'.repeat(4001) }).success).toBe(false);
  });
});
