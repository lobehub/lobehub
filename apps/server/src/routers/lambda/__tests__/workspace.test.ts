// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { workspaceRouter } from '@/business/server/lambda-routers/workspace';

describe('workspaceRouter.getById', () => {
  it('returns null in the community build', async () => {
    const caller = workspaceRouter.createCaller({
      serverDB: {},
      userId: 'user-1',
      workspaceId: 'ignored-community-workspace',
    } as never);

    await expect(caller.getById()).resolves.toBeNull();
  });
});
