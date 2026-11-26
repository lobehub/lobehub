// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { redactRevokedSnapshots, revokedContextSources } from './index';

vi.mock('@/database/models/project', () => ({
  ProjectModel: class {
    findById = async () => {
      throw new Error('connection reset');
    };
  },
}));

describe('context replay withholding', () => {
  it('drops a deleted memory without invalidating the rest of the snapshot', () => {
    const result = redactRevokedSnapshots(
      {
        a1: {
          invocationId: 'a1',
          sessionKey: 'openai:gpt-4',
          version: 1,
          sourceIds: ['memory:preferences:m1', 'tool:web'],
          changes: [
            {
              key: 'UserMemoryInjector',
              sourceIds: ['memory:preferences:m1'],
              messages: [{ id: 'm1', role: 'user', content: 'LIKES GREEN TEA' }],
            },
            {
              key: 'ToolSystemRoleProvider',
              sourceIds: ['tool:web'],
              messages: [{ id: 't1', role: 'user', content: 'USE WEB SEARCH' }],
            },
          ],
        },
      },
      ['memory:preferences:m1'],
    );
    expect(result.a1.invalidated).toBeFalsy();
    expect(JSON.stringify(result)).not.toContain('LIKES GREEN TEA');
    expect(JSON.stringify(result)).toContain('USE WEB SEARCH');
  });

  it('surfaces an unexpected lookup failure instead of treating it as revoked', async () => {
    await expect(
      revokedContextSources({ db: {} as never, userId: 'user-1' }, ['project:p1']),
    ).rejects.toThrow('connection reset');
  });
});
