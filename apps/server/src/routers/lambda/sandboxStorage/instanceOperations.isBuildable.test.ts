import { describe, expect, it } from 'vitest';

import { isBuildable } from './instanceOperations';

describe('isBuildable', () => {
  it('builds a definition that clones a repository or runs setup', () => {
    expect(isBuildable({ sources: [{}] })).toBe(true);
    expect(isBuildable({ bootstrapCommand: 'pnpm i', sources: [] })).toBe(true);
    expect(isBuildable({ sources: [] })).toBe(false);
    expect(isBuildable(null)).toBe(false);
  });

  it('has nothing to build when every repository is local-only', () => {
    expect(isBuildable({ sources: [{ localOnly: true }] })).toBe(false);
    expect(isBuildable({ sources: [{ localOnly: true }, {}] })).toBe(true);
    expect(isBuildable({ bootstrapCommand: 'make', sources: [{ localOnly: true }] })).toBe(true);
  });
});
