import { describe, expect, it } from 'vitest';

import { generateCredsList } from './helpers';

describe('generateCredsList', () => {
  it("tags a member-shared credential with who shared it, never as the workspace's own", () => {
    const result = generateCredsList([
      {
        key: 'github',
        name: 'GitHub Token',
        ownerDisplayName: 'Alice',
        ownerType: 'user',
        type: 'kv-env',
      },
    ]);

    expect(result).toContain('[shared by Alice]');
    expect(result).not.toContain('[workspace credential]');
  });

  it('tags a workspace-owned credential distinctly from a shared one', () => {
    const result = generateCredsList([
      { key: 'openai', name: 'OpenAI Key', ownerType: 'organization', type: 'kv-env' },
    ]);

    expect(result).toContain('[workspace credential]');
    expect(result).not.toContain('[shared by');
  });

  it('falls back to a generic label when a shared credential has no owner display name', () => {
    const result = generateCredsList([
      { key: 'github', name: 'GitHub Token', ownerType: 'user', type: 'kv-env' },
    ]);

    expect(result).toContain('[shared by a workspace member]');
  });

  it('adds no ownership tag for a personal-only list (ownerType absent)', () => {
    const result = generateCredsList([{ key: 'openai', name: 'OpenAI Key', type: 'kv-env' }]);

    expect(result).not.toContain('[shared by');
    expect(result).not.toContain('[workspace credential]');
  });
});
