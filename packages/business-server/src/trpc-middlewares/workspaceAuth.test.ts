// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { router } from '@/libs/trpc/lambda';

import { wsCompatProcedure } from './workspaceAuth';

const testRouter = router({
  context: wsCompatProcedure.query(({ ctx }) => ({
    workspaceId: ctx.workspaceId,
    workspaceSlug: ctx.workspaceSlug,
  })),
});

describe('community wsCompatProcedure', () => {
  it('does not synthesize a workspace slug', async () => {
    const caller = testRouter.createCaller({
      userId: 'user-1',
      workspaceId: 'unverified-workspace',
    } as never);

    await expect(caller.context()).resolves.toEqual({
      workspaceId: 'unverified-workspace',
      workspaceSlug: undefined,
    });
  });
});
